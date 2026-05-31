const { parse, visit, print } = require('graphql');
const { buildSchema, GraphQLObjectType } = require('graphql');

class QueryPlanOptimizer {
  constructor() {
    this.serviceSchemaMap = new Map();
    this.entityResolvers = new Map();
  }

  registerService(serviceName, schemaSdl) {
    this.serviceSchemaMap.set(serviceName, schemaSdl);
  }

  optimizeQueryPlan(queryString, context) {
    const ast = parse(queryString);
    const plan = this.buildOptimizedPlan(ast, context);
    
    return {
      originalQuery: queryString,
      optimizedPlan: plan,
      statistics: this.calculatePlanStatistics(plan),
    };
  }

  buildOptimizedPlan(ast, context) {
    const plan = {
      phases: [],
      entityBatches: new Map(),
      fieldDependencies: new Map(),
    };

    visit(ast, {
      OperationDefinition: (node) => {
        const phase = this.analyzeSelectionSet(node.selectionSet, context);
        plan.phases.push(phase);
      },
    });

    this.optimizePhases(plan);
    
    return plan;
  }

  analyzeSelectionSet(selectionSet, context) {
    const phase = {
      serviceCalls: [],
      nestedPhases: [],
      batchableEntities: [],
    };

    if (!selectionSet) return phase;

    selectionSet.selections.forEach((selection) => {
      if (selection.kind === 'Field') {
        const fieldAnalysis = this.analyzeField(selection, context);
        if (fieldAnalysis.requiresServiceCall) {
          phase.serviceCalls.push(fieldAnalysis);
        }
        if (fieldAnalysis.isEntityReference) {
          phase.batchableEntities.push(fieldAnalysis);
        }
        if (selection.selectionSet) {
          const nestedPhase = this.analyzeSelectionSet(selection.selectionSet, context);
          if (nestedPhase.serviceCalls.length > 0 || nestedPhase.batchableEntities.length > 0) {
            phase.nestedPhases.push({
              field: selection.name.value,
              phase: nestedPhase,
            });
          }
        }
      }
    });

    return phase;
  }

  analyzeField(field, context) {
    const fieldName = field.name.value;
    
    return {
      fieldName,
      serviceName: this.determineServiceForField(fieldName),
      requiresServiceCall: this.isFederatedField(fieldName),
      isEntityReference: this.isEntityReferenceField(fieldName),
      returnType: this.getFieldReturnType(fieldName),
      selectionSet: field.selectionSet,
      arguments: field.arguments?.map(arg => ({
        name: arg.name.value,
        value: this.parseArgumentValue(arg.value),
      })) || [],
    };
  }

  determineServiceForField(fieldName) {
    const fieldServiceMap = {
      user: 'users',
      users: 'users',
      searchUsers: 'users',
      order: 'orders',
      orders: 'orders',
      ordersByUser: 'orders',
      ordersByStatus: 'orders',
      recentOrders: 'orders',
      product: 'products',
      products: 'products',
      searchProducts: 'products',
      productsByCategory: 'products',
      featuredProducts: 'products',
    };
    
    return fieldServiceMap[fieldName] || 'unknown';
  }

  isFederatedField(fieldName) {
    const federatedFields = ['orders', 'items', 'product', 'user'];
    return federatedFields.includes(fieldName);
  }

  isEntityReferenceField(fieldName) {
    const entityFields = ['product', 'user', 'order'];
    return entityFields.includes(fieldName);
  }

  getFieldReturnType(fieldName) {
    const returnTypeMap = {
      user: 'User',
      users: '[User]',
      order: 'Order',
      orders: '[Order]',
      product: 'Product',
      products: '[Product]',
      items: '[OrderItem]',
    };
    
    return returnTypeMap[fieldName] || 'Unknown';
  }

  parseArgumentValue(value) {
    if (value.kind === 'Variable') {
      return { type: 'variable', name: value.name.value };
    }
    if (value.kind === 'IntValue') {
      return parseInt(value.value);
    }
    if (value.kind === 'StringValue') {
      return value.value;
    }
    return value.value;
  }

  optimizePhases(plan) {
    plan.phases.forEach((phase) => {
      this.optimizeBatchableEntities(phase);
      this.reorderServiceCalls(phase);
    });
  }

  optimizeBatchableEntities(phase) {
    const entityGroups = new Map();
    
    phase.batchableEntities.forEach((entity) => {
      const key = `${entity.serviceName}:${entity.returnType}`;
      if (!entityGroups.has(key)) {
        entityGroups.set(key, []);
      }
      entityGroups.get(key).push(entity);
    });
    
    phase.optimizedBatches = Array.from(entityGroups.entries()).map(([key, entities]) => ({
      key,
      entityCount: entities.length,
      sampleEntity: entities[0],
    }));
  }

  reorderServiceCalls(phase) {
    phase.serviceCalls.sort((a, b) => {
      const priorityA = this.getServiceCallPriority(a);
      const priorityB = this.getServiceCallPriority(b);
      return priorityA - priorityB;
    });
  }

  getServiceCallPriority(serviceCall) {
    const priorityMap = {
      users: 1,
      orders: 2,
      products: 3,
    };
    
    return priorityMap[serviceCall.serviceName] || 99;
  }

  calculatePlanStatistics(plan) {
    let totalServiceCalls = 0;
    let totalBatchedEntities = 0;
    let nestedDepth = 0;
    
    const countPhase = (phase) => {
      totalServiceCalls += phase.serviceCalls.length;
      totalBatchedEntities += phase.batchableEntities.length;
      
      phase.nestedPhases.forEach(({ phase: nestedPhase }) => {
        nestedDepth++;
        countPhase(nestedPhase);
      });
    };
    
    plan.phases.forEach(countPhase);
    
    return {
      estimatedServiceCalls: totalServiceCalls,
      batchableEntities: totalBatchedEntities,
      maxNestingDepth: nestedDepth,
      potentialOptimization: totalBatchedEntities > 0 
        ? `Could reduce service calls by up to ${Math.round((totalBatchedEntities / Math.max(1, totalServiceCalls)) * 100)}%`
        : 'No batch optimization available',
    };
  }

  generateOptimizedQuery(originalQuery, plan) {
    const ast = parse(originalQuery);
    
    const optimizedAst = visit(ast, {
      Field: {
        leave: (node) => {
          if (this.isEntityReferenceField(node.name.value)) {
            return {
              ...node,
              directives: [
                ...(node.directives || []),
                {
                  kind: 'Directive',
                  name: { kind: 'Name', value: 'batch' },
                },
              ],
            };
          }
          return node;
        },
      },
    });
    
    return print(optimizedAst);
  }
}

const queryPlanOptimizer = new QueryPlanOptimizer();

module.exports = { queryPlanOptimizer, QueryPlanOptimizer };
