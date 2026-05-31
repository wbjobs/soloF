export function generateJWT(payload, secret = 'your-secret-key-change-in-production') {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 60 * 60 * 24,
  };

  const base64Url = (str) => {
    return btoa(JSON.stringify(str))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  };

  const signature = base64Url(header) + '.' + base64Url(fullPayload);
  
  return signature + '.' + base64Url({ sig: signature + secret });
}

export function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload;
  } catch (e) {
    return null;
  }
}

export function validateJWT(token) {
  const payload = decodeJWT(token);
  if (!payload) return false;
  
  const now = Math.floor(Date.now() / 1000);
  return payload.exp > now;
}

export function getCurrentUser() {
  const token = localStorage.getItem('jwt_token');
  if (!token) return null;
  return decodeJWT(token);
}

export function login(username, password, role = 'user') {
  const tenant = username;
  const payload = {
    sub: username,
    username: username,
    tenant: tenant,
    role: role,
    'https://dgraph.io/jwt/claims': {
      'X-Dgraph-Allowed-roles': [role],
      'owner': tenant,
    },
  };
  
  return generateJWT(payload);
}

export function logout() {
  localStorage.removeItem('jwt_token');
}

export function getOwner() {
  const user = getCurrentUser();
  return user ? user.tenant || user.username;
}
