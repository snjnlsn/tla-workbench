import {expect, test} from '@playwright/test';

test('import, configure, run, inspect a counterexample, and reopen a model',async({page})=>{
  await page.goto('./');
  await page.locator('#upload').setInputFiles(['example_tla/Test.tla','example_tla/Test.cfg']);
  const summary = page.getByRole('status');
  await expect(summary).toContainText('Exploration complete');
  await expect(summary).toContainText('2003');
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
