function buildPayload(attr) {
  return {
    attribute: {
      attribute_code: attr.code,
      frontend_input: attr.inputType || 'text',
      default_frontend_label: attr.label,
      is_user_defined: true,
      is_visible: true
    }
  };
}

module.exports = {
  buildPayload
};