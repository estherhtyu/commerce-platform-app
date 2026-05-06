const { post } = require('./commerce.client');

async function createAttribute(config, token, payload) {
  try {
    const url = `${config.baseUrl}/V1/products/attributes`;
    console.log(`Creating attribute with code '${payload.attribute_code}' at URL: ${url}`);
    return await post(url, token, payload);
  } catch (error) {
    console.error(`Error creating attribute with code '${payload.attribute_code}':`, error);
    throw error;
  }
}

module.exports = {
  createAttribute
};
