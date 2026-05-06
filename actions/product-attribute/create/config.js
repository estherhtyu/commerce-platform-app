function getConfig(params) {
  return {
    baseUrl: params.MAGENTO_BASE_URL,
    token: params.TOKEN
  };
}

module.exports = {
  getConfig
}