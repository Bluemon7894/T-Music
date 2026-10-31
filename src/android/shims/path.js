const path = {
  join: (...parts) => parts.filter(Boolean).join('/').replace(/\/+/g, '/'),
};

export default path;
