const path = require('node:path');

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: true,
    output: 'standalone',
    outputFileTracingRoot: path.resolve(__dirname),
};

module.exports = nextConfig;
