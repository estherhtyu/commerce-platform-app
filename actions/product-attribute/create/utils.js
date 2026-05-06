function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return text;
  }
}

function successResponse(data) {
  return {
    statusCode: 200,
    body: data
  };
}

function errorResponse(error) {
  return {
    statusCode: 500,
    body: { error: error.message }
  };
}

function formatResult(code, status, error = null) {
  return {
    code,
    status,
    ...(error && { error })
  };
}

function log(message, data = null) {
  console.log("LOG:", message, data || "");
}

module.exports = {
  safeParse,
  successResponse,
  errorResponse,
  formatResult,
  log
};