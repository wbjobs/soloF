use crate::config::Rule;
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum FilterError {
    #[error("Field not found: {0}")]
    FieldNotFound(String),
    #[error("Invalid field type, expected number")]
    InvalidType,
    #[error("Invalid operator: {0}")]
    InvalidOperator(String),
}

pub fn evaluate_rule(rule: &Rule, data: &Value) -> Result<bool, FilterError> {
    let field_value = data
        .get(&rule.field)
        .ok_or(FilterError::FieldNotFound(rule.field.clone()))?;

    let num_value = field_value.as_f64().ok_or(FilterError::InvalidType)?;

    let result = match rule.operator.as_str() {
        "gt" => num_value > rule.value,
        "lt" => num_value < rule.value,
        "gte" => num_value >= rule.value,
        "lte" => num_value <= rule.value,
        "eq" => (num_value - rule.value).abs() < f64::EPSILON,
        "ne" => (num_value - rule.value).abs() >= f64::EPSILON,
        op => return Err(FilterError::InvalidOperator(op.to_string())),
    };

    Ok(result)
}

pub fn filter_message(rules: &[Rule], data: &Value) -> Vec<&Rule> {
    rules
        .iter()
        .filter(|rule| match evaluate_rule(rule, data) {
            Ok(true) => true,
            Ok(false) => false,
            Err(e) => {
                log::debug!("Rule evaluation skipped for '{}': {}", rule.name, e);
                false
            }
        })
        .collect()
}

pub fn should_forward(rules: &[Rule], data: &Value) -> bool {
    !filter_message(rules, data).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_gt_rule() {
        let rule = Rule {
            name: "test".to_string(),
            field: "temperature".to_string(),
            operator: "gt".to_string(),
            value: 30.0,
        };
        let data = json!({"temperature": 35.0});
        assert!(evaluate_rule(&rule, &data).unwrap());
    }

    #[test]
    fn test_lt_rule() {
        let rule = Rule {
            name: "test".to_string(),
            field: "humidity".to_string(),
            operator: "lt".to_string(),
            value: 20.0,
        };
        let data = json!({"humidity": 15.0});
        assert!(evaluate_rule(&rule, &data).unwrap());
    }

    #[test]
    fn test_filter_multiple_rules() {
        let rules = vec![
            Rule {
                name: "high-temp".to_string(),
                field: "temperature".to_string(),
                operator: "gt".to_string(),
                value: 30.0,
            },
            Rule {
                name: "low-humidity".to_string(),
                field: "humidity".to_string(),
                operator: "lt".to_string(),
                value: 20.0,
            },
        ];
        let data = json!({"temperature": 35.0, "humidity": 50.0});
        let matched = filter_message(&rules, &data);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].name, "high-temp");
    }
}
