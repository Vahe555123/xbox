const net = require('net');
const nodemailer = require('nodemailer');
const config = require('../config');

function getSmtpFamily() {
  const family = Number(config.auth.smtp.family);
  return family === 4 || family === 6 ? family : null;
}

function openFamilySocket(options, callback) {
  const family = getSmtpFamily();
  if (!family) {
    return setImmediate(() => callback(null, false));
  }

  const socket = net.connect({
    host: options.host,
    port: options.port,
    family,
    localAddress: options.localAddress,
  });

  let settled = false;
  const timeoutMs = options.connectionTimeout || config.auth.smtp.connectionTimeoutMs;

  const finish = (err, result) => {
    if (settled) return;
    settled = true;
    socket.removeAllListeners('connect');
    socket.removeAllListeners('error');
    socket.removeAllListeners('timeout');
    socket.setTimeout(0);

    if (err) {
      socket.destroy();
      return callback(err);
    }

    return callback(null, result);
  };

  socket.setTimeout(timeoutMs, () => {
    const err = new Error(`SMTP connection timed out after ${timeoutMs}ms`);
    err.code = 'ETIMEDOUT';
    finish(err);
  });

  socket.once('error', finish);
  socket.once('connect', () => finish(null, { connection: socket }));
}

function createSmtpTransport() {
  return nodemailer.createTransport({
    host: config.auth.smtp.host,
    port: config.auth.smtp.port,
    secure: config.auth.smtp.secure,
    family: config.auth.smtp.family,
    dnsTimeout: config.auth.smtp.dnsTimeoutMs,
    connectionTimeout: config.auth.smtp.connectionTimeoutMs,
    greetingTimeout: config.auth.smtp.greetingTimeoutMs,
    socketTimeout: config.auth.smtp.socketTimeoutMs,
    getSocket: openFamilySocket,
    auth: {
      user: config.auth.smtp.username,
      pass: config.auth.smtp.password,
    },
  });
}

function getFromAddress() {
  if (config.auth.smtp.from) return config.auth.smtp.from;
  if (!config.auth.smtp.fromEmail) return config.auth.smtp.username;
  return `"${config.auth.smtp.fromName}" <${config.auth.smtp.fromEmail}>`;
}

module.exports = {
  createSmtpTransport,
  getFromAddress,
};
