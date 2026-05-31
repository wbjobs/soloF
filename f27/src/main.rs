use clap::Parser;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(short, long)]
    contract: PathBuf,
}

#[derive(Debug, Serialize, Deserialize)]
struct FunctionReport {
    name: String,
    start_line: usize,
    end_line: usize,
    complexity: u32,
    vulnerabilities: Vec<Vulnerability>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Vulnerability {
    r#type: String,
    description: String,
    line: usize,
}

#[derive(Debug, Serialize, Deserialize)]
struct Dependency {
    path: String,
    is_relative: bool,
    import_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ContractReport {
    file_name: String,
    total_lines: usize,
    total_functions: usize,
    external_dependencies_count: usize,
    external_dependencies: Vec<Dependency>,
    functions: Vec<FunctionReport>,
}

fn count_lines(content: &str) -> usize {
    content.lines().count()
}

fn parse_imports(content: &str) -> Vec<Dependency> {
    let mut dependencies = Vec::new();
    
    let import_patterns = [
        (r#"import\s+"([^"]+)""#, "simple"),
        (r#"import\s+'([^']+)'"#, "simple"),
        (r#"import\s+\*\s+as\s+\w+\s+from\s+"([^"]+)""#, "namespace"),
        (r#"import\s+\*\s+as\s+\w+\s+from\s+'([^']+)'"#, "namespace"),
        (r#"import\s+\{[^}]+\}\s+from\s+"([^"]+)""#, "named"),
        (r#"import\s+\{[^}]+\}\s+from\s+'([^']+)'"#, "named"),
        (r#"import\s+"([^"]+)"\s+as\s+\w+"#, "alias"),
        (r#"import\s+'([^']+)'\s+as\s+\w+"#, "alias"),
    ];
    
    for (pattern, import_type) in import_patterns.iter() {
        let re = Regex::new(pattern).unwrap();
        for caps in re.captures_iter(content) {
            let path = caps[1].to_string();
            let is_relative = path.starts_with("./") || path.starts_with("../");
            
            let exists = dependencies.iter().any(|d: &Dependency| &d.path == &path);
            if !exists {
                dependencies.push(Dependency {
                    path: path.clone(),
                    is_relative,
                    import_type: import_type.to_string(),
                });
            }
        }
    }
    
    dependencies.sort_by(|a, b| a.path.cmp(&b.path));
    dependencies
}

fn extract_functions(content: &str) -> Vec<(String, usize, usize, String)> {
    let mut functions = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    
    let function_re = Regex::new(r"^\s*(function|modifier)\s+(\w+)").unwrap();
    
    let mut i = 0;
    while i < lines.len() {
        if let Some(caps) = function_re.captures(lines[i]) {
            let func_name = caps[2].to_string();
            let start_line = i + 1;
            
            let mut brace_count = 0;
            let mut found_brace = false;
            let mut j = i;
            
            while j < lines.len() {
                for c in lines[j].chars() {
                    match c {
                        '{' => {
                            brace_count += 1;
                            found_brace = true;
                        }
                        '}' => {
                            brace_count -= 1;
                        }
                        _ => {}
                    }
                }
                
                if found_brace && brace_count == 0 {
                    let end_line = j + 1;
                    let func_body: Vec<&str> = lines[start_line-1..end_line].to_vec();
                    functions.push((func_name, start_line, end_line, func_body.join("\n")));
                    i = j;
                    break;
                }
                j += 1;
            }
        }
        i += 1;
    }
    
    functions
}

fn remove_unchecked_blocks(function_body: &str) -> String {
    let mut result = String::new();
    let mut in_unchecked = false;
    let mut brace_count = 0;
    
    let lines: Vec<&str> = function_body.lines().collect();
    let mut i = 0;
    
    while i < lines.len() {
        let line = lines[i];
        
        if !in_unchecked && line.contains("unchecked") {
            in_unchecked = true;
            brace_count = 0;
        }
        
        if in_unchecked {
            for c in line.chars() {
                match c {
                    '{' => brace_count += 1,
                    '}' => {
                        brace_count -= 1;
                        if brace_count == 0 {
                            in_unchecked = false;
                        }
                    }
                    _ => {}
                }
            }
        } else {
            result.push_str(line);
            result.push('\n');
        }
        
        i += 1;
    }
    
    result
}

fn calculate_cyclomatic_complexity(function_body: &str) -> u32 {
    let cleaned_body = remove_unchecked_blocks(function_body);
    let mut complexity = 1;
    
    let decision_points = [
        r"\bif\b", r"\belse\s+if\b", r"\bwhile\b", r"\bfor\b", r"\bdo\b",
        "&&", r"\|\|", r"\?", r"\bcase\b", r"\bdefault:"
    ];
    
    for point in decision_points.iter() {
        let re = Regex::new(point).unwrap();
        complexity += re.find_iter(&cleaned_body).count() as u32;
    }
    
    complexity
}

fn extract_function_calls(line: &str) -> Vec<String> {
    let mut calls = Vec::new();
    let re = Regex::new(r"(\w+)\s*\(").unwrap();
    for caps in re.captures_iter(line) {
        let func_name = &caps[1];
        if func_name != "require" && func_name != "revert" && func_name != "assert" {
            calls.push(func_name.to_string());
        }
    }
    calls
}

fn modifies_state(function_body: &str) -> bool {
    let state_change_re = Regex::new(r"(balances|allowance|_balances|_allowances|totalSupply|_totalSupply)\s*(\[.*\])?\s*=").unwrap();
    state_change_re.is_match(function_body)
}

fn detect_reentrancy(function_body: &str, start_line: usize, all_functions: &HashMap<String, String>) -> Vec<Vulnerability> {
    let mut vulnerabilities = Vec::new();
    let lines: Vec<&str> = function_body.lines().collect();
    
    let call_value_re = Regex::new(r"\.call\{.*value.*\}").unwrap();
    let send_re = Regex::new(r"\.send\(").unwrap();
    let transfer_re = Regex::new(r"\.transfer\(").unwrap();
    
    for (i, line) in lines.iter().enumerate() {
        let has_external_call = call_value_re.is_match(line) || send_re.is_match(line) || transfer_re.is_match(line);
        
        if has_external_call {
            for j in (i + 1)..lines.len() {
                let state_change_re = Regex::new(r"(balances|allowance|_balances|_allowances|totalSupply|_totalSupply)\s*(\[.*\])?\s*=").unwrap();
                
                if state_change_re.is_match(lines[j]) {
                    vulnerabilities.push(Vulnerability {
                        r#type: "Reentrancy".to_string(),
                        description: "Potential reentrancy vulnerability: state variable modified after external call".to_string(),
                        line: start_line + j,
                    });
                    break;
                }
                
                let function_calls = extract_function_calls(lines[j]);
                for func_call in function_calls {
                    if let Some(called_func_body) = all_functions.get(&func_call) {
                        if modifies_state(called_func_body) {
                            vulnerabilities.push(Vulnerability {
                                r#type: "Reentrancy".to_string(),
                                description: format!("Potential reentrancy vulnerability: function '{}' (which modifies state) called after external call", func_call),
                                line: start_line + j,
                            });
                            break;
                        }
                    }
                }
            }
        }
    }
    
    vulnerabilities
}

fn detect_unchecked_send(function_body: &str, start_line: usize) -> Vec<Vulnerability> {
    let mut vulnerabilities = Vec::new();
    let lines: Vec<&str> = function_body.lines().collect();
    
    let send_re = Regex::new(r"\.send\(").unwrap();
    let call_re = Regex::new(r"\.call\{").unwrap();
    
    for (i, line) in lines.iter().enumerate() {
        if (send_re.is_match(line) || call_re.is_match(line)) && !line.contains("require") && !line.contains("if") {
            vulnerabilities.push(Vulnerability {
                r#type: "Unchecked Send".to_string(),
                description: "External call return value not checked".to_string(),
                line: start_line + i,
            });
        }
    }
    
    vulnerabilities
}

fn is_solidity_08_or_higher(content: &str) -> bool {
    let pragma_re = Regex::new(r"pragma\s+solidity\s+[\^>=]?\s*0\.(\d+)").unwrap();
    if let Some(caps) = pragma_re.captures(content) {
        if let Ok(minor_version) = caps[1].parse::<u32>() {
            return minor_version >= 8;
        }
    }
    false
}

fn is_in_unchecked_block(lines: &[&str], current_line: usize) -> bool {
    let mut brace_count = 0;
    let mut in_unchecked = false;
    
    for i in 0..=current_line {
        let line = lines[i];
        if !in_unchecked && line.contains("unchecked") {
            in_unchecked = true;
            brace_count = 0;
        }
        
        if in_unchecked {
            for c in line.chars() {
                match c {
                    '{' => brace_count += 1,
                    '}' => {
                        brace_count -= 1;
                        if brace_count == 0 {
                            in_unchecked = false;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    
    in_unchecked
}

fn detect_integer_overflow(function_body: &str, start_line: usize, is_solc_08: bool) -> Vec<Vulnerability> {
    let mut vulnerabilities = Vec::new();
    let lines: Vec<&str> = function_body.lines().collect();
    
    let arithmetic_ops = [r"\+\+", r"--", r"\+=", r"-=", r"\*=", r"/="];
    
    for (i, line) in lines.iter().enumerate() {
        for op in arithmetic_ops.iter() {
            let re = Regex::new(op).unwrap();
            let in_unchecked = is_in_unchecked_block(&lines, i);
            
            if re.is_match(line) && !line.contains("SafeMath") {
                if !is_solc_08 || (is_solc_08 && in_unchecked) {
                    vulnerabilities.push(Vulnerability {
                        r#type: "Integer Overflow/Underflow".to_string(),
                        description: if is_solc_08 {
                            "Potential integer overflow/underflow: arithmetic operation inside unchecked block".to_string()
                        } else {
                            "Potential integer overflow/underflow: arithmetic operation without SafeMath or Solidity 0.8+".to_string()
                        },
                        line: start_line + i,
                    });
                    break;
                }
            }
        }
    }
    
    vulnerabilities
}

fn main() {
    let args = Args::parse();
    
    let content = fs::read_to_string(&args.contract)
        .expect("Failed to read contract file");
    
    let file_name = args.contract
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    
    let is_solc_08 = is_solidity_08_or_higher(&content);
    let total_lines = count_lines(&content);
    let functions = extract_functions(&content);
    let external_dependencies = parse_imports(&content);
    
    let mut all_functions: HashMap<String, String> = HashMap::new();
    for (name, _, _, body) in &functions {
        all_functions.insert(name.clone(), body.clone());
    }
    
    let mut function_reports = Vec::new();
    
    for (name, start_line, end_line, body) in functions {
        let complexity = calculate_cyclomatic_complexity(&body);
        let mut vulnerabilities = Vec::new();
        
        vulnerabilities.extend(detect_reentrancy(&body, start_line, &all_functions));
        vulnerabilities.extend(detect_unchecked_send(&body, start_line));
        vulnerabilities.extend(detect_integer_overflow(&body, start_line, is_solc_08));
        
        function_reports.push(FunctionReport {
            name,
            start_line,
            end_line,
            complexity,
            vulnerabilities,
        });
    }
    
    let report = ContractReport {
        file_name,
        total_lines,
        total_functions: function_reports.len(),
        external_dependencies_count: external_dependencies.len(),
        external_dependencies,
        functions: function_reports,
    };
    
    let json_output = serde_json::to_string_pretty(&report)
        .expect("Failed to serialize report");
    
    println!("{}", json_output);
}
