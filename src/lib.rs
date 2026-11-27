//! Check finite-state models and return a graph of reachable states.
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

type Result<T> = std::result::Result<T, String>;
type State = Vec<Scalar>;

#[derive(Clone)]
enum Expr {
    Atom(String),
    Binary(String, Box<Expr>, Box<Expr>),
}
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Scalar {
    Int(i64),
    Bool(bool),
    Text(String),
}
impl Scalar {
    fn json(&self) -> Value {
        match self {
            Self::Int(n) => json!(n),
            Self::Bool(b) => json!(b),
            Self::Text(s) => json!(s),
        }
    }
    fn integer(self) -> Result<i64> {
        match self {
            Self::Int(n) => Ok(n),
            _ => Err("Expected an integer".into()),
        }
    }
    fn boolean(self) -> Result<bool> {
        match self {
            Self::Bool(b) => Ok(b),
            _ => Err("Expected a predicate".into()),
        }
    }
}
fn identifier(s: &str) -> bool {
    s.starts_with(|c: char| c.is_ascii_alphabetic())
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}
// Expand aligned junction lists into grouped expressions before precedence parsing.
fn tokens(source: &str) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let mut lists: Vec<(usize, usize, String)> = Vec::new();
    let mut depth: usize = 0;
    let mut operand = true;
    for line in source.lines() {
        let mut s = line;
        let mut first = true;
        while !s.trim_start().is_empty() {
            s = s.trim_start();
            let column = line[..line.len() - s.len()].chars().count();
            let n = if s.starts_with('"') {
                let mut escaped = false;
                let mut end = None;
                for (i, c) in s.char_indices().skip(1) {
                    if escaped {
                        escaped = false;
                    } else if c == '\\' {
                        escaped = true;
                    } else if c == '"' {
                        end = Some(i + 1);
                        break;
                    }
                }
                end.ok_or("Unterminated string literal")?
            } else if let Some(op) = [
                "\\in", "..", "/\\", "\\/", "<=", ">=", "/=", "(", ")", "+", "-", "*", "=", "<",
                ">",
            ]
            .iter()
            .find(|op| s.starts_with(**op))
            {
                op.len()
            } else {
                s.bytes()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == 39)
                    .count()
            };
            if n == 0 {
                return Err(format!(
                    "Unsupported syntax near {}",
                    s.chars().take(16).collect::<String>()
                ));
            }
            let symbol = &s[..n];
            let mut sibling = false;
            while let Some((indent, level, bullet)) = lists.last() {
                if first && column <= *indent && depth > *level {
                    return Err("Parenthesized expression crosses a junction list boundary".into());
                }
                if *level != depth {
                    break;
                }
                if first && column == *indent && symbol == bullet {
                    out.extend([")".into(), symbol.into(), "(".into()]);
                    sibling = true;
                    break;
                }
                if (first && column <= *indent) || symbol == ")" {
                    out.extend([")".into(), ")".into()]);
                    lists.pop();
                } else {
                    break;
                }
            }
            if !sibling {
                if operand && matches!(symbol, "/\\" | "\\/") {
                    lists.push((column, depth, symbol.into()));
                    out.extend(["(".into(), "(".into()]);
                } else {
                    if symbol == "(" {
                        depth += 1
                    }
                    if symbol == ")" {
                        depth = depth
                            .checked_sub(1)
                            .ok_or("Unexpected closing parenthesis")?
                    }
                    out.push(symbol.into());
                }
            }
            operand = precedence(symbol) > 0 || symbol == "(";
            first = false;
            s = &s[n..];
        }
    }
    for _ in lists {
        out.extend([")".into(), ")".into()]);
    }
    Ok(out)
}
fn precedence(s: &str) -> u8 {
    match s {
        "\\/" => 2,
        "/\\" => 2,
        "\\in" | "=" | "/=" | "<" | ">" | "<=" | ">=" => 3,
        ".." => 4,
        "+" => 5,
        "-" => 6,
        "*" => 8,
        _ => 0,
    }
}
fn parse(t: &[String], p: &mut usize, min: u8) -> Result<Expr> {
    let token = t.get(*p).ok_or("Expected an expression")?;
    *p += 1;
    let mut left = match token.as_str() {
        "(" => {
            let e = parse(t, p, 1)?;
            if t.get(*p).map(String::as_str) != Some(")") {
                return Err("Missing closing parenthesis".into());
            }
            *p += 1;
            e
        }
        "-" => Expr::Binary(
            "-".into(),
            Box::new(Expr::Atom("0".into())),
            Box::new(parse(t, p, 7)?),
        ),
        s if s.starts_with('"')
            || identifier(s.trim_end_matches('\''))
            || s.parse::<i64>().is_ok() =>
        {
            Expr::Atom(s.into())
        }
        _ => return Err(format!("Unexpected token {token}")),
    };
    let mut previous: Option<&str> = None;
    while let Some(op) = t.get(*p) {
        let k = precedence(op);
        if k < min {
            break;
        }
        if let Some(prev) = previous {
            if precedence(prev) == k
                && (prev != op || !matches!(op.as_str(), "/\\" | "\\/" | "+" | "-" | "*"))
            {
                return Err(format!(
                    "Precedence conflict between {prev} and {op}; use parentheses"
                ));
            }
        }
        previous = Some(op.as_str());
        *p += 1;
        left = Expr::Binary(op.clone(), Box::new(left), Box::new(parse(t, p, k + 1)?));
    }
    Ok(left)
}
fn expression(s: &str) -> Result<Expr> {
    let t = tokens(s)?;
    let mut p = 0;
    let e = parse(&t, &mut p, 1)?;
    if p != t.len() {
        return Err(format!("Unexpected token {}", t[p]));
    }
    Ok(e)
}
fn eval(e: &Expr, vars: &[String], state: &State) -> Result<Scalar> {
    use Scalar::*;
    match e {
        Expr::Atom(s) => match s.as_str() {
            s if s.starts_with('"') => serde_json::from_str(s)
                .map(Text)
                .map_err(|_| "Invalid string literal".into()),
            "TRUE" => Ok(Bool(true)),
            "FALSE" => Ok(Bool(false)),
            _ => {
                if let Ok(n) = s.parse() {
                    return Ok(Int(n));
                }
                vars.iter()
                    .position(|v| v == s)
                    .and_then(|i| state.get(i))
                    .cloned()
                    .ok_or(format!("Unknown value {s}"))
            }
        },
        Expr::Binary(op, a, b) => {
            let a = eval(a, vars, state)?;
            let b = eval(b, vars, state)?;
            match op.as_str() {
                "/\\" => Ok(Bool(a.boolean()? & b.boolean()?)),
                "\\/" => Ok(Bool(a.boolean()? | b.boolean()?)),
                "=" | "/=" => Ok(Bool((a == b) == (op == "="))),
                _ => {
                    let (a, b) = (a.integer()?, b.integer()?);
                    Ok(match op.as_str() {
                        "<" => Bool(a < b),
                        ">" => Bool(a > b),
                        "<=" => Bool(a <= b),
                        ">=" => Bool(a >= b),
                        "+" | "-" | "*" => Int(match op.as_str() {
                            "+" => a.checked_add(b),
                            "-" => a.checked_sub(b),
                            _ => a.checked_mul(b),
                        }
                        .ok_or("Integer overflow")?),
                        _ => return Err(format!("Unknown operator {op}")),
                    })
                }
            }
        }
    }
}
fn parts<'a>(e: &'a Expr, op: &str, out: &mut Vec<&'a Expr>) {
    if let Expr::Binary(k, a, b) = e {
        if k == op {
            parts(a, op, out);
            parts(b, op, out);
            return;
        }
    }
    out.push(e)
}
enum Domain {
    Single(Scalar),
    Range(i64, i64),
}
impl Domain {
    fn first(&self) -> Option<Scalar> {
        match self {
            Self::Single(value) => Some(value.clone()),
            Self::Range(lo, hi) if lo <= hi => Some(Scalar::Int(*lo)),
            Self::Range(..) => None,
        }
    }
}
// Visit the Cartesian product lazily so a large interval respects the state limit.
fn visit_states(domains: &[Domain], mut visit: impl FnMut(&State) -> bool) {
    let Some(mut current): Option<State> = domains.iter().map(Domain::first).collect() else {
        return;
    };
    loop {
        if !visit(&current) {
            return;
        }
        let mut advanced = false;
        for (value, domain) in current.iter_mut().zip(domains).rev() {
            if let (Scalar::Int(n), Domain::Range(lo, hi)) = (value, domain) {
                if *n < *hi {
                    *n += 1;
                    advanced = true;
                    break;
                }
                *n = *lo;
            }
        }
        if !advanced {
            return;
        }
    }
}
fn domains(e: &Expr, vars: &[String], state: &State, initial: bool) -> Result<Option<Vec<Domain>>> {
    let mut terms = vec![];
    parts(e, "/\\", &mut terms);
    let mut bindings = Vec::new();
    for term in terms {
        if let Expr::Binary(op, l, r) = term {
            if let Expr::Atom(name) = l.as_ref() {
                let target = if initial {
                    Some(name.as_str())
                } else {
                    name.strip_suffix('\'')
                };
                if let Some(i) = target.and_then(|n| vars.iter().position(|v| v == n)) {
                    if op == "=" || op == "\\in" {
                        bindings.push((i, op, r));
                        continue;
                    }
                }
            }
        }
        if !eval(term, vars, state)?.boolean()? {
            return Ok(None);
        }
    }
    let mut result: Vec<Option<Domain>> = (0..vars.len()).map(|_| None).collect();
    for (i, op, r) in bindings {
        let domain = if op == "=" {
            Domain::Single(eval(r, vars, state)?)
        } else {
            match r.as_ref() {
                Expr::Binary(range, lo, hi) if range == ".." => Domain::Range(
                    eval(lo, vars, state)?.integer()?,
                    eval(hi, vars, state)?.integer()?,
                ),
                _ => return Err("Expected an inclusive integer interval after \\in".into()),
            }
        };
        if result[i].replace(domain).is_some() {
            return Err(format!("Repeated assignment for {}", vars[i]));
        }
    }
    Ok(Some(result.into_iter().collect::<Option<Vec<_>>>().ok_or(
        "Assign every variable once in Init and in each action",
    )?))
}

fn check(source: &str, input: &Value, limit: usize) -> Result<Value> {
    let init_name = input["init"].as_str().unwrap_or("Init");
    let next_name = input["next"].as_str().unwrap_or("Next");
    let deadlocks = input["deadlock"].as_bool().unwrap_or(false);
    let mut vars = vec![];
    let mut defs = BTreeMap::new();
    let mut pending: Option<(String, String)> = None;
    let mut module = false;
    let mut closed = false;
    let mut lines = source.lines();
    let mut remainder = None;
    while let Some(raw) = remainder.take().or_else(|| lines.next()) {
        let mut quoted = false;
        let mut escaped = false;
        let mut end = raw.len();
        for (i, c) in raw.char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if quoted && c == '\\' {
                escaped = true;
                continue;
            }
            if c == '"' {
                quoted = !quoted
            }
            if !quoted && raw[i..].starts_with("\\*") {
                end = i;
                break;
            }
        }
        let code = raw[..end].trim_end();
        let prefix = code.trim_end_matches('=');
        if !prefix.trim().is_empty() && code.len() - prefix.len() >= 4 {
            remainder = Some(&code[prefix.len()..]);
            end = prefix.len();
        }
        let end_of_code = end;
        let line = raw[..end].trim();
        if line.is_empty() {
            continue;
        }
        if closed {
            return Err("Unexpected text after module end".into());
        }
        if !module {
            let h = line.trim_matches('-').trim();
            if !line.starts_with("----")
                || !line.ends_with("----")
                || !h
                    .strip_prefix("MODULE ")
                    .is_some_and(|s| identifier(s.trim()))
            {
                return Err("Expected a TLA+ module header".into());
            }
            module = true;
            continue;
        }
        let end = line.len() >= 4 && line.bytes().all(|b| b == b'=');
        let definition = line
            .split_once("==")
            .filter(|(name, _)| identifier(name.trim()));
        if end || definition.is_some() {
            if let Some((name, body)) = pending.take() {
                if defs
                    .insert(
                        name.clone(),
                        expression(&body).map_err(|s| format!("{name}: {s}"))?,
                    )
                    .is_some()
                {
                    return Err(format!("Duplicate definition {name}"));
                }
            }
        }
        if end {
            closed = true;
            continue;
        }
        if let Some((name, body)) = definition {
            if !identifier(name.trim()) {
                return Err("Expected a named definition".into());
            }
            let column = raw.len() - raw.trim_start().len() + name.len() + 2;
            pending = Some((name.trim().into(), format!("{}{body}", " ".repeat(column))));
            continue;
        }
        if let Some((_, s)) = &mut pending {
            s.push('\n');
            s.push_str(&raw[..end_of_code]);
            continue;
        }
        if line == "EXTENDS Naturals" || line == "EXTENDS Integers" {
            continue;
        }
        if let Some(s) = line
            .strip_prefix("VARIABLES ")
            .or_else(|| line.strip_prefix("VARIABLE "))
        {
            vars.extend(s.split(',').map(|x| x.trim().to_string()));
            continue;
        }
        return Err(format!("Unsupported declaration: {line}"));
    }
    if !closed {
        return Err("Expected ==== at the end of the module".into());
    }
    if vars.is_empty()
        || vars.iter().any(|s| !identifier(s))
        || vars.iter().collect::<BTreeSet<_>>().len() != vars.len()
    {
        return Err("Declare unique variables".into());
    }
    let mut initial_terms = vec![];
    parts(
        defs.get(init_name).ok_or(format!("Define {init_name}"))?,
        "\\/",
        &mut initial_terms,
    );
    let mut states = Vec::new();
    let mut ids = BTreeMap::new();
    let mut status = "passed";
    for term in initial_terms {
        if let Some(choices) = domains(term, &vars, &vec![], true)? {
            visit_states(&choices, |state| {
                if !ids.contains_key(state) {
                    if states.len() >= limit {
                        status = "limited";
                        return false;
                    }
                    ids.insert(state.clone(), states.len());
                    states.push(state.clone());
                }
                true
            });
        }
        if status == "limited" {
            break;
        }
    }
    if states.is_empty() {
        return Err("Init has no initial state".into());
    }
    let initial_count = states.len();
    let invariant = input["invariant"].as_str().unwrap_or_else(|| {
        if defs.contains_key("Safety") {
            "Safety"
        } else {
            ""
        }
    });
    let inv = if invariant.is_empty() {
        None
    } else {
        Some(
            defs.get(invariant)
                .ok_or(format!("Define invariant {invariant}"))?,
        )
    };
    let mut alternatives = vec![];
    parts(
        defs.get(next_name).ok_or(format!("Define {next_name}"))?,
        "\\/",
        &mut alternatives,
    );
    let mut actions = vec![];
    for e in alternatives {
        if let Expr::Atom(name) = e {
            actions.push((
                name.as_str(),
                defs.get(name).ok_or(format!("Unknown action {name}"))?,
            ))
        } else {
            actions.push(("Next", e))
        }
    }
    let mut parents = vec![None; initial_count];
    let mut edges = vec![];
    let mut trace = vec![];
    let mut i = 0;
    'search: while status == "passed" && i < states.len() {
        if let Some(inv) = inv {
            if !eval(inv, &vars, &states[i])?.boolean()? {
                status = "violated";
                break;
            }
        }
        let mut enabled = false;
        for (name, e) in &actions {
            if let Some(options) = domains(e, &vars, &states[i], false)? {
                visit_states(&options, |next| {
                    enabled = true;
                    let j = if let Some(j) = ids.get(next) {
                        *j
                    } else {
                        if states.len() >= limit {
                            status = "limited";
                            return false;
                        }
                        let j = states.len();
                        ids.insert(next.clone(), j);
                        states.push(next.clone());
                        parents.push(Some(i));
                        j
                    };
                    edges.push(json!([i, j, name]));
                    true
                });
                if status == "limited" {
                    break 'search;
                }
            }
        }
        if deadlocks && !enabled {
            status = "deadlock";
            break;
        }
        i += 1
    }
    if status == "violated" || status == "deadlock" {
        let mut at = Some(i);
        while let Some(j) = at {
            trace.push(j);
            at = parents[j]
        }
        trace.reverse();
    }
    let states: Vec<Vec<Value>> = states
        .iter()
        .map(|state| state.iter().map(Scalar::json).collect())
        .collect();
    Ok(
        json!({"status":status,"invariant":invariant,"initial_count":initial_count,"variables":vars,"states":states,"edges":edges,"trace":trace}),
    )
}
thread_local! {static OUTPUT:RefCell<Vec<u8>>=const{RefCell::new(Vec::new())};}
#[no_mangle]
pub extern "C" fn reserve(n: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; n].into_boxed_slice()) as *mut u8
}
/// Consume the input buffer allocated by reserve and retain the JSON response.
#[no_mangle]
pub unsafe extern "C" fn run(ptr: *mut u8, n: usize) -> usize {
    let bytes = Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, n));
    let result = (|| -> Result<Value> {
        let input: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        check(
            input["source"].as_str().ok_or("Missing source")?,
            &input,
            input["limit"].as_u64().unwrap_or(10000).clamp(1, 10000) as usize,
        )
    })();
    OUTPUT.with(|o| {
        let mut o = o.borrow_mut();
        *o = result
            .unwrap_or_else(|error| json!({"status":"error","error":error}))
            .to_string()
            .into_bytes();
        o.len()
    })
}
#[no_mangle]
pub extern "C" fn output() -> *const u8 {
    OUTPUT.with(|o| o.borrow().as_ptr())
}
