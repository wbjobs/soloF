const AuthPolicy = require('../models/AuthPolicy');
const DeviceFingerprint = require('../models/DeviceFingerprint');
const AuthLog = require('../models/AuthLog');
const User = require('../models/User');

class PolicyEngine {
  static async evaluatePolicy(userId, context) {
    const policies = await AuthPolicy.findActiveByUser(userId);
    
    if (policies.length === 0) {
      return this.getDefaultPolicy(context);
    }

    for (const policy of policies) {
      if (await this.matchConditions(policy.conditions, context)) {
        return {
          policyId: policy.id,
          policyName: policy.name,
          requiredFactors: policy.required_factors,
          isDefault: policy.is_default
        };
      }
    }

    const defaultPolicy = policies.find(p => p.is_default);
    if (defaultPolicy) {
      return {
        policyId: defaultPolicy.id,
        policyName: defaultPolicy.name,
        requiredFactors: defaultPolicy.required_factors,
        isDefault: true
      };
    }

    return this.getDefaultPolicy(context);
  }

  static async matchConditions(conditions, context) {
    if (!conditions || Object.keys(conditions).length === 0) {
      return true;
    }

    for (const [conditionType, conditionValue] of Object.entries(conditions)) {
      const isMatch = await this.evaluateCondition(conditionType, conditionValue, context);
      if (!isMatch) {
        return false;
      }
    }

    return true;
  }

  static async evaluateCondition(type, value, context) {
    switch (type) {
      case 'newDevice':
        if (value === true) {
          return await DeviceFingerprint.isNewDevice(context.userId, context.fingerprint);
        }
        return !(await DeviceFingerprint.isNewDevice(context.userId, context.fingerprint));

      case 'trustedDevice':
        if (value === true) {
          return await DeviceFingerprint.isTrustedDevice(context.userId, context.fingerprint);
        }
        return !(await DeviceFingerprint.isTrustedDevice(context.userId, context.fingerprint));

      case 'ipChange':
        return context.ipChanged === value;

      case 'locationChange':
        return context.locationChanged === value;

      case 'timeOfDay':
        return this.checkTimeOfDay(value, context.currentTime || new Date());

      case 'recentFailures':
        const failures = await AuthLog.getRecentFailures(context.userId, context.fingerprint, 1);
        return failures >= value;

      case 'firstTimeLogin':
        return context.firstTime === value;

      case 'geoLocation':
        return this.checkGeoLocation(value, context.location);

      default:
        return true;
    }
  }

  static checkTimeOfDay(range, currentTime) {
    const hour = currentTime.getHours();
    
    if (range.type === 'outside') {
      const [start, end] = range.hours;
      return hour < start || hour >= end;
    }
    
    if (range.type === 'inside') {
      const [start, end] = range.hours;
      return hour >= start && hour < end;
    }

    return true;
  }

  static checkGeoLocation(allowedLocations, currentLocation) {
    if (!allowedLocations || !Array.isArray(allowedLocations)) {
      return true;
    }
    return allowedLocations.includes(currentLocation);
  }

  static getDefaultPolicy(context) {
    const requiredFactors = [];

    if (context.enabledFactors?.webauthn) {
      requiredFactors.push('webauthn');
    } else if (context.enabledFactors?.totp) {
      requiredFactors.push('totp');
    }

    if (requiredFactors.length === 0 && context.enabledFactors?.backup) {
      requiredFactors.push('backup');
    }

    if (context.isNewDevice) {
      if (context.enabledFactors?.webauthn) {
        requiredFactors.push('webauthn');
      }
      if (context.enabledFactors?.totp && !requiredFactors.includes('totp')) {
        requiredFactors.push('totp');
      }
    }

    return {
      policyId: null,
      policyName: 'Default Policy',
      requiredFactors,
      isDefault: true
    };
  }

  static async createDefaultPolicies(userId) {
    const policies = [
      {
        name: 'Trusted Device',
        description: 'Use only WebAuthn for trusted devices',
        priority: 100,
        conditions: { trustedDevice: true },
        requiredFactors: ['webauthn'],
        isDefault: false
      },
      {
        name: 'New Device - Enhanced Security',
        description: 'Require WebAuthn + TOTP for new devices',
        priority: 50,
        conditions: { newDevice: true },
        requiredFactors: ['webauthn', 'totp'],
        isDefault: false
      },
      {
        name: 'Standard Login',
        description: 'Default policy for normal logins',
        priority: 0,
        conditions: {},
        requiredFactors: ['webauthn'],
        isDefault: true
      }
    ];

    const createdPolicies = [];
    for (const policy of policies) {
      const created = await AuthPolicy.create(
        userId,
        policy.name,
        policy.description,
        policy.conditions,
        policy.requiredFactors,
        policy.priority
      );
      createdPolicies.push(created);

      if (policy.isDefault) {
        await AuthPolicy.setDefault(userId, created.id);
      }
    }

    return createdPolicies;
  }

  static getAvailableConditions() {
    return [
      {
        type: 'newDevice',
        name: 'New Device',
        description: 'Device has not been used before',
        valueType: 'boolean'
      },
      {
        type: 'trustedDevice',
        name: 'Trusted Device',
        description: 'Device is marked as trusted',
        valueType: 'boolean'
      },
      {
        type: 'ipChange',
        name: 'IP Changed',
        description: 'IP address is different from last login',
        valueType: 'boolean'
      },
      {
        type: 'recentFailures',
        name: 'Recent Failures',
        description: 'Number of recent failed login attempts',
        valueType: 'number',
        min: 1,
        max: 10
      },
      {
        type: 'timeOfDay',
        name: 'Time of Day',
        description: 'Login during specific hours',
        valueType: 'object',
        schema: {
          type: { enum: ['inside', 'outside'] },
          hours: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }
        }
      }
    ];
  }
}

module.exports = PolicyEngine;
