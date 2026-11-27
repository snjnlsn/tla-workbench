//! Evaluate an action directly against one state, including choices beyond the search limit.
use super::*;

fn literal(value: &Scalar) -> String {
    match value {
        Scalar::Bool(true) => "TRUE".into(),
        Scalar::Bool(false) => "FALSE".into(),
        _ => value.json().to_string(),
    }
}

pub(super) fn literals(state: &State) -> Vec<String> {
    state.iter().map(literal).collect()
}

fn parse_value(value: &Value) -> Result<Scalar> {
    let text = value.as_str().ok_or("Expected a value")?.trim();
    match text {
        "TRUE" | "true" => Ok(Scalar::Bool(true)),
        "FALSE" | "false" => Ok(Scalar::Bool(false)),
        _ if text.starts_with('"') => serde_json::from_str(text)
            .map(Scalar::Text)
            .map_err(|_| "Enter a quoted string".into()),
        _ => text
            .parse::<i64>()
            .map(Scalar::Int)
            .map_err(|_| "Enter an integer, TRUE, FALSE, or a quoted string".into()),
    }
}

fn parse_state(input: &Value, vars: &[String]) -> Result<State> {
    let values = input
        .as_array()
        .filter(|a| a.len() == vars.len())
        .ok_or("Expected one value per variable")?;
    vars.iter()
        .zip(values)
        .map(|(name, v)| parse_value(v).map_err(|e| format!("{name}: {e}")))
        .collect()
}

fn describe(domain: &Domain, current: &Scalar) -> Value {
    let (first, last) = match domain {
        Domain::Single(value) => (value.clone(), value.clone()),
        Domain::Range(lo, hi) => (Scalar::Int(*lo), Scalar::Int(*hi)),
    };
    json!({"first":literal(&first),"last":literal(&last),"editable": first != *current || last != *current})
}

pub(super) fn step(
    input: &Value,
    vars: &[String],
    init: &[&Expr],
    actions: &[(&str, &Expr)],
    inv: Option<&Expr>,
) -> Result<Value> {
    let mut state = if input["current"].is_null() {
        let mut first = None;
        for term in init {
            if let Some(options) = domains(term, vars, &vec![], true)? {
                first = options.iter().map(Domain::first).collect::<Option<State>>();
                if first.is_some() {
                    break;
                }
            }
        }
        first.ok_or("Init has no initial state")?
    } else {
        parse_state(&input["current"], vars)?
    };
    if !input["candidate"].is_null() {
        let index = input["action"].as_u64().ok_or("Select an action")? as usize;
        let (_, expr) = actions.get(index).ok_or("Unknown action")?;
        let options = domains(expr, vars, &state, false)?.ok_or("This action is disabled")?;
        let candidate = parse_state(&input["candidate"], vars)?;
        for ((name, domain), value) in vars.iter().zip(options).zip(&candidate) {
            match domain {
                Domain::Single(expected) if expected != *value => {
                    return Err(format!("{name} must be {}", literal(&expected)))
                }
                Domain::Range(lo, hi) if !matches!(value,Scalar::Int(n) if lo<=*n && *n<=hi) => {
                    return Err(format!("{name} must be an integer from {lo} to {hi}"))
                }
                _ => (),
            }
        }
        state = candidate;
    }
    let mut enabled = vec![];
    for (index, (name, expr)) in actions.iter().enumerate() {
        if let Some(options) = domains(expr, vars, &state, false)? {
            if options
                .iter()
                .any(|d| matches!(d,Domain::Range(lo,hi) if lo>hi))
            {
                continue;
            }
            let fields: Vec<_> = options
                .iter()
                .zip(&state)
                .map(|(d, v)| describe(d, v))
                .collect();
            enabled.push(json!({"index":index,"name":name,"fields":fields}));
        }
    }
    let safe = inv
        .map(|expr| eval(expr, vars, &state)?.boolean())
        .transpose()?;
    Ok(
        json!({"status":"ready","variables":vars,"current":literals(&state),"actions":enabled,"safe":safe}),
    )
}
