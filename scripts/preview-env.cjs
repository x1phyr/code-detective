const os = require('node:os');

const original = os.networkInterfaces;
os.networkInterfaces = function safeNetworkInterfaces() {
  try {
    return original.call(os);
  } catch {
    return {};
  }
};
