/*
* <license header>
*/

/**
 * This is a sample action showcasing how to access an external API
 *
 * Note:
 * You might want to disable authentication and authorization checks against Adobe Identity Management System for a generic action. In that case:
 *   - Remove the require-adobe-auth annotation for this action in the manifest.yml of your application
 *   - Remove the Authorization header from the array passed in checkMissingRequestInputs
 *   - The two steps above imply that every client knowing the URL to this deployed action will be able to invoke it without any authentication and authorization checks against Adobe Identity Management System
 *   - Make sure to validate these changes against your security requirements before deploying the action
 */

const { getConfig } = require('./config');
const { buildPayload } = require('./payload');
const { createAttribute } = require('./attribute.service');

const {
  successResponse,
  errorResponse,
  formatResult,
  log
} = require('./utils');

async function main(params) {
  try {
    const config = getConfig(params);
    const token = config.token;
    const attributes = params.attributes || [];
    log(" token ====", token);
    log("===Starting attribute creationss=======");
    log("All Param ====", JSON.stringify(params, null, 2));
    log("attribute values ====", JSON.stringify(attributes, null, 2));
    const results = [];
    for (const attr of attributes) {
      try {
        // payload build
        const payload = buildPayload(attr);
        const result = await createAttribute(config, token, payload);
        results.push(formatResult(attr.code, 'SUCCESS'));
      } catch (err) {
        results.push({
          code: attr.code,
          status: 'FAILED',
          message: err.message
        });
      }
    }

    return {
      statusCode: 200,
      body: results
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: err.message
    };
  }
}

exports.main = main;
