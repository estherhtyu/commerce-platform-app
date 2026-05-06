
async function post(url, token, payload) {

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-api-key': process.env.OAUTH_CLIENT_ID
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

module.exports = {
  post
};