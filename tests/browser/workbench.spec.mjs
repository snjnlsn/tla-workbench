import {expect, test} from '@playwright/test';

test('import, configure, run, inspect a counterexample, and reopen a model',async({page})=>{
  await page.goto('./');
  await page.locator('#upload').setInputFiles(['example_tla/Test.tla','example_tla/Test.cfg']);
  const summary = page.getByRole('status');
  await expect(summary).toContainText('Exploration complete');
  await expect(summary).toContainText('2003');
  await page.getByRole('button',{name:'State graph',exact:true}).click();
  const choices=page.getByLabel('Enabled transitions');
  await choices.selectOption({label:'Pick → S1001'});
  await page.getByRole('button',{name:'Step',exact:true}).click();
  await expect(page.locator('#inspector')).toContainText('i = 1000');
  await page.getByRole('button',{name:'Step',exact:true}).click();
  await expect(page.locator('#inspector')).toContainText('i = 1001');
  await expect(choices).toBeDisabled();
  await page.getByRole('button',{name:'Back',exact:true}).click();
  await expect(page.locator('#inspector')).toContainText('pc = "middle"');
  await page.getByRole('button',{name:/Configuration/}).click();
  const cfg=page.getByLabel('Configuration file');
  await cfg.fill((await cfg.inputValue()).replace('CHECK_DEADLOCK FALSE','CHECK_DEADLOCK TRUE'));
  await page.getByRole('button',{name:'Apply and run'}).click();
  await expect(summary).toContainText('Deadlock found');
  await expect(page.locator('#inspector')).toContainText('pc = "done"');
  await page.locator('#trace button').first().click();
  await expect(page.locator('#inspector')).toContainText('pc = "start"');
  await page.reload();
  await expect(summary).toContainText('Deadlock found');
});

test('edit and rerun after an ambiguous expression',async({page})=>{
  await page.goto('./');
  await page.locator('#upload').setInputFiles(['tests/parity/fixtures/Grouping.tla','tests/parity/fixtures/Grouping.cfg']);
  await expect(page.getByRole('status')).toContainText('Precedence conflict');
  const editor=page.getByLabel('TLA+ specification editor');
  await editor.fill((await editor.inputValue()).replace('FALSE /\\ FALSE','(FALSE /\\ FALSE)'));
  await page.getByRole('button',{name:/Run model/}).click();
  await expect(page.getByRole('status')).toContainText('Invariant holds');
});

test('try values on both example paths and retain the graph picker',async({page})=>{
  await page.goto('./');
  const sim=page.locator('#simulator');
  await expect(page.getByLabel('Active project')).toHaveValue('0');
  await expect(page.locator('#projectList option')).toHaveCount(1);
  await expect(sim.getByRole('combobox',{name:'Action'})).toHaveValue('0');
  const seats=sim.getByRole('spinbutton',{name:/seats′/});
  await seats.fill('4');
  await sim.getByRole('button',{name:'Try transition'}).click();
  await expect(sim).toContainText('seats must be an integer from 1 to 3');
  await expect(sim.locator('dd').first()).toHaveText('"open"');
  await seats.fill('2');
  await sim.getByRole('button',{name:'Try transition'}).click();
  await expect(sim.locator('dd').last()).toHaveText('2');
  await expect(seats).toHaveCount(0);
  await sim.getByRole('button',{name:'Back'}).click();
  await expect(sim.locator('dd').last()).toHaveText('0');
  await page.getByRole('button',{name:/SadPath.tla/}).click();
  await expect(page.getByRole('status')).toContainText('Invariant violated');
  await expect(sim.locator('dd').first()).toHaveText('"open"');
  await seats.fill('4');
  await sim.getByRole('button',{name:'Try transition'}).click();
  await expect(sim).toContainText('This state violates the invariant');
  await sim.getByRole('button',{name:'Try transition'}).click();
  await expect(sim.locator('dd').first()).toHaveText('"confirmed"');
  await sim.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(sim.locator('dd')).toHaveText(['"open"','0']);
  await expect(sim.getByRole('button',{name:'Back',exact:true})).toHaveCount(0);
  await expect(seats).toHaveValue('1');
  await seats.fill('9');
  await sim.getByRole('button',{name:'Try transition'}).click();
  await expect(sim).toContainText('seats must be an integer');
  await sim.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(seats).toHaveValue('1');
  await expect(sim).not.toContainText('seats must be an integer');
  await page.getByRole('button',{name:'State graph',exact:true}).click();
  await expect(page.getByLabel('Reachable state graph')).toBeVisible();
});

test('projects keep their models separate and import a public /tla tree atomically',async({page})=>{
  await page.goto('./');
  await page.getByRole('button',{name:'New project'}).click();
  await page.getByLabel('Name',{exact:true}).fill('Workshop');
  await page.getByRole('button',{name:'Create project'}).click();
  await page.locator('#upload').setInputFiles(['tla/HappyPath.tla','tla/SadPath.tla']);
  await expect(page.locator('#files button')).toHaveCount(3);
  const endpoint='https://api.github.com/repos/samples/booking/git/';
  await page.route(endpoint+'**',async route=>{
    const key=route.request().url().slice(endpoint.length);
    const replies={
      'trees/HEAD':{tree:[{type:'tree',path:'tla',sha:'tree'}]},
      'trees/tree?recursive=1':{tree:[
        {type:'blob',path:'nested/Booking.tla',sha:'model'},
        {type:'blob',path:'nested/Booking.cfg',sha:'config'},
        {type:'blob',path:'README.md',sha:'ignored'},
      ]},
    };
    if(key in replies)return route.fulfill({json:replies[key]});
    if(key==='blobs/model')return route.fulfill({body:"---- MODULE Booking ----\nVARIABLE x\nInit == x = 0\nNext == x' = x\n===="});
    if(key==='blobs/config')return route.fulfill({body:'INIT Init\nNEXT Next\nCHECK_DEADLOCK FALSE'});
    throw Error(key);
  });
  await page.getByRole('button',{name:'Import from GitHub'}).click();
  await page.getByLabel('Public repository URL').fill('https://github.com/samples/booking');
  await page.getByRole('button',{name:'Import project',exact:true}).click();
  await expect(page.locator('#projectCrumb')).toHaveText('samples/booking');
  await expect(page.locator('#files button')).toHaveCount(1);
  await expect(page.locator('#filename')).toHaveText('nested/Booking.tla');
  await expect(page.getByRole('status')).toContainText('Exploration complete');
  await page.reload();
  await expect(page.locator('#projectCrumb')).toHaveText('samples/booking');
  await page.getByLabel('Active project').selectOption({label:'Workshop'});
  await expect(page.locator('#files button')).toHaveCount(3);
});

test('previous workspaces survive migration',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('tla-workbench-1',JSON.stringify({active:0,files:[
    {name:'Saved',source:"---- MODULE Saved ----\nVARIABLE x\nInit == x = 7\nNext == x' = x\n====",limit:10}]})));
  await page.goto('./');
  await expect(page.locator('#projectCrumb')).toHaveText('Previous workspace');
  await expect(page.locator('#filename')).toHaveText('Saved.tla');
  await expect(page.locator('#simulator dd')).toHaveText('7');
});

test('string fields accept plain text, including empty values and literal quotes',async({page})=>{
  await page.goto('./');
  const values=['TRUE','42','  say "yes"  ',''];
  const actions=values.map((value,i)=>'Step'+i+' == s = '+JSON.stringify(i?values[i-1]:'initial')+" /\\ s' = "+JSON.stringify(value));
  const source=['---- MODULE Strings ----','VARIABLE s','Init == s = "initial"','Safety == TRUE',...actions,
    'Next == '+values.map((_,i)=>'Step'+i).join(' \\/ '),'===='].join('\n');
  await page.getByLabel('TLA+ specification editor').fill(source);
  await page.getByRole('button',{name:/Run model/}).click();
  const runner=page.locator('#simulator');
  for(const value of values){
    const field=runner.getByRole('textbox',{name:'s′'});
    await expect(field).toHaveValue(value);
    await field.fill(value);
    await runner.getByRole('button',{name:'Try transition'}).click();
    await expect(runner.locator('dd')).toHaveText(JSON.stringify(value),{useInnerText:false});
  }
  await expect(runner).toContainText('No enabled actions');
});

test('Boolean choices and native integer validation',async({page})=>{
  await page.goto('./');
  const source=['---- MODULE Controls ----','VARIABLES enabled, n','Init == enabled = FALSE /\\ n = 0',
    "Next == enabled' = TRUE /\\ n' \\in 1..3",'Safety == TRUE','===='].join('\n');
  await page.getByLabel('TLA+ specification editor').fill(source);
  await page.getByRole('button',{name:/Run model/}).click();
  const runner=page.locator('#simulator');
  const bool=runner.getByRole('combobox',{name:'enabled′'});
  const number=runner.getByRole('spinbutton',{name:/n′/});
  await expect(bool).toHaveValue('TRUE');
  await number.fill('1.5');
  await runner.getByRole('button',{name:'Try transition'}).click();
  expect(await number.evaluate(input=>input.validity.stepMismatch)).toBe(true);
  await expect(runner.locator('dd').last()).toHaveText('0');
  await number.fill('2');
  await bool.selectOption('FALSE');
  await runner.getByRole('button',{name:'Try transition'}).click();
  await expect(runner).toContainText('enabled must be TRUE');
  await bool.selectOption('TRUE');
  await runner.getByRole('button',{name:'Try transition'}).click();
  await expect(runner.locator('dd')).toHaveText(['TRUE','2']);
});
