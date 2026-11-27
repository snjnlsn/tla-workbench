//! Check finite integer-state models and return a graph of reachable states.
use serde_json::{json, Value};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

type Result<T> = std::result::Result<T, String>;
type State = Vec<i64>;

#[derive(Clone)]
enum Expr {
    Atom(String),
    Binary(String, Box<Expr>, Box<Expr>),
}
#[derive(PartialEq)]
enum Scalar {
    Int(i64),
    Bool(bool),
}
impl Scalar {
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
fn tokens(mut s: &str) -> Result<Vec<String>> {
    let mut out = Vec::new();
    while !s.trim_start().is_empty() {
        s = s.trim_start();
        let n = if let Some(op) = [
            "/\\", "\\/", "<=", ">=", "/=", "(", ")", "+", "-", "*", "=", "<", ">",
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
        out.push(s[..n].to_string());
        s = &s[n..];
    }
    Ok(out)
}
fn precedence(s: &str) -> u8 {
    match s {
        "\\/" => 1,
        "/\\" => 2,
        "=" | "/=" | "<" | ">" | "<=" | ">=" => 3,
        "+" | "-" => 4,
        "*" => 5,
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
            Box::new(parse(t, p, 6)?),
        ),
        s if identifier(s.trim_end_matches('\'')) || s.parse::<i64>().is_ok() => {
            Expr::Atom(s.into())
        }
        _ => return Err(format!("Unexpected token {token}")),
    };
    while let Some(op) = t.get(*p) {
        let k = precedence(op);
        if k < min {
            break;
        }
        *p += 1;
        left = Expr::Binary(op.clone(), Box::new(left), Box::new(parse(t, p, k + 1)?));
    }
    Ok(left)
}
fn expression(s: &str) -> Result<Expr> {
    let mut t = tokens(s)?;
    if matches!(t.first().map(String::as_str), Some("/\\") | Some("\\/")) {
        t.remove(0);
    }
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
            "TRUE" => Ok(Bool(true)),
            "FALSE" => Ok(Bool(false)),
            _ => {
                if let Ok(n) = s.parse() {
                    return Ok(Int(n));
                }
                vars.iter()
                    .position(|v| v == s)
                    .and_then(|i| state.get(i))
                    .map(|n| Int(*n))
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
fn successor(e: &Expr, vars: &[String], state: &State, initial: bool) -> Result<Option<State>> {
    let mut terms = vec![];
    parts(e, "/\\", &mut terms);
    let mut values = vec![None; vars.len()];
    let mut enabled = true;
    for term in terms {
        if let Expr::Binary(op, l, r) = term {
            if let Expr::Atom(name) = l.as_ref() {
                let target = if initial {
                    Some(name.as_str())
                } else {
                    name.strip_suffix('\'')
                };
                if let Some(i) = target.and_then(|n| vars.iter().position(|v| v == n)) {
                    if op == "=" {
                        let value = eval(r, vars, state)?.integer()?;
                        if values[i].replace(value).is_some() {
                            return Err(format!("Repeated assignment for {}", vars[i]));
                        }
                        continue;
                    }
                }
            }
        }
        enabled &= eval(term, vars, state)?.boolean()?;
    }
    if values.contains(&None) {
        return Err("Assign every variable once in Init and in each action".into());
    }
    Ok(enabled.then(|| values.into_iter().flatten().collect()))
}
fn check(source: &str, invariant: &str, limit: usize) -> Result<Value> {
    let mut vars = vec![];
    let mut defs = BTreeMap::new();
    let mut pending: Option<(String, String)> = None;
    let mut module = false;
    let mut closed = false;
    for raw in source.lines() {
        let line = raw.split("\\*").next().unwrap().trim();
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
        if end || line.contains("==") {
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
        if let Some((name, body)) = line.split_once("==") {
            if !identifier(name.trim()) {
                return Err("Expected a named definition".into());
            }
            pending = Some((name.trim().into(), body.into()));
            continue;
        }
        if let Some((_, s)) = &mut pending {
            s.push(' ');
            s.push_str(line);
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
        return Err("Declare unique integer variables".into());
    }
    let init = successor(defs.get("Init").ok_or("Define Init")?, &vars, &vec![], true)?
        .ok_or("Init has no initial state")?;
    let inv = defs
        .get(invariant)
        .ok_or(format!("Define invariant {invariant}"))?;
    let mut alternatives = vec![];
    parts(
        defs.get("Next").ok_or("Define Next")?,
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
    let mut states = vec![init.clone()];
    let mut ids = BTreeMap::from([(init, 0)]);
    let mut parents = vec![None];
    let mut edges = vec![];
    let mut trace = vec![];
    let mut status = "passed";
    let mut i = 0;
    'search: while i < states.len() {
        if !eval(inv, &vars, &states[i])?.boolean()? {
            status = "violated";
            let mut at = Some(i);
            while let Some(j) = at {
                trace.push(j);
                at = parents[j]
            }
            trace.reverse();
            break;
        }
        for (name, e) in &actions {
            if let Some(next) = successor(e, &vars, &states[i], false)? {
                let j = if let Some(j) = ids.get(&next) {
                    *j
                } else {
                    if states.len() >= limit {
                        status = "limited";
                        break 'search;
                    }
                    let j = states.len();
                    ids.insert(next.clone(), j);
                    states.push(next);
                    parents.push(Some(i));
                    j
                };
                edges.push(json!([i, j, name]));
            }
        }
        i += 1
    }
    Ok(json!({"status":status,"variables":vars,"states":states,"edges":edges,"trace":trace}))
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
            input["invariant"].as_str().ok_or("Missing invariant")?,
            input["limit"].as_u64().unwrap_or(1000).clamp(1, 10000) as usize,
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
