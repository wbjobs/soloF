const { parse, visit } = require('graphql');

function detectNPlusOne(queryStr, responseData) {
  const issues = [];
  
  try {
    const ast = parse(queryStr);
    
    const fieldPatterns = analyzeFieldPatterns(ast);
    
    if (responseData) {
      const dataStructureIssues = analyzeResponseStructure(responseData, fieldPatterns);
      issues.push(...dataStructureIssues);
    }
    
    const queryStructureIssues = analyzeQueryStructure(ast);
    issues.push(...queryStructureIssues);
    
  } catch (e) {
    console.error('Error analyzing N+1:', e);
  }
  
  return issues;
}

function analyzeFieldPatterns(ast) {
  const patterns = [];
  
  visit(ast, {
    Field(node) {
      if (node.selectionSet) {
        const nestedFields = node.selectionSet.selections
          .filter(s => s.kind === 'Field')
          .map(s => s.name.value);
        
        patterns.push({
          parentField: node.name.value,
          nestedFields,
          hasNestedObjects: nestedFields.length > 0,
        });
      }
    },
  });
  
  return patterns;
}

function analyzeResponseStructure(data, fieldPatterns) {
  const issues = [];
  
  function traverse(obj, path = []) {
    if (!obj || typeof obj !== 'object') return;
    
    if (Array.isArray(obj)) {
      if (obj.length > 1) {
        const firstItem = obj[0];
        if (firstItem && typeof firstItem === 'object') {
          Object.keys(firstItem).forEach(key => {
            if (Array.isArray(firstItem[key]) && firstItem[key].length > 0) {
              issues.push({
                type: 'POTENTIAL_N+1',
                path: [...path, key].join('.'),
                description: `Nested array '${key}' found in list items - potential N+1 query pattern`,
                severity: 'MEDIUM',
                suggestion: `Consider using DataLoader or batched queries for '${key}'`,
              });
            }
          });
        }
      }
      obj.forEach((item, i) => traverse(item, [...path, `[${i}]`]));
    } else {
      Object.entries(obj).forEach(([key, value]) => {
        traverse(value, [...path, key]);
      });
    }
  }
  
  traverse(data);
  return issues;
}

function analyzeQueryStructure(ast) {
  const issues = [];
  
  visit(ast, {
    Field(node) {
      if (node.selectionSet) {
        const listFields = node.selectionSet.selections.filter(
          s => s.kind === 'Field' && isPluralField(s.name.value)
        );
        
        if (listFields.length > 0 && isPluralField(node.name.value)) {
          issues.push({
            type: 'NESTED_LIST_QUERY',
            field: node.name.value,
            nestedFields: listFields.map(f => f.name.value),
            description: `Nested list query detected: ${node.name.value} contains ${listFields.map(f => f.name.value).join(', ')}`,
            severity: 'HIGH',
            suggestion: 'Review resolver implementation to ensure batched data loading',
          });
        }
      }
    },
  });
  
  return issues;
}

function isPluralField(fieldName) {
  const pluralPatterns = ['s', 'es', 'list', 'items', 'connections', 'edges'];
  return pluralPatterns.some(pattern => 
    fieldName.toLowerCase().endsWith(pattern) || 
    fieldName.toLowerCase().includes(pattern)
  );
}

module.exports = { detectNPlusOne };
