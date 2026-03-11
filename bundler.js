require('dotenv').config();
const createBundler = require('@airtable/blocks-webpack-bundler').default;
const { DefinePlugin } = require('webpack');

function customizeWebpackConfig(config) {
    if (!config.plugins) config.plugins = [];
    config.plugins.push(
        new DefinePlugin({
            'process.env.NGROK_URL': JSON.stringify(process.env.NGROK_URL || null),
        })
    );

    // Add postcss-loader to the CSS rule so Tailwind is processed by webpack
    const cssRule = config.module.rules.find(r => r.test && r.test.toString() === '/\\.css$/');
    if (cssRule && Array.isArray(cssRule.use)) {
        cssRule.use.push('postcss-loader');
    }

    return config;
}

exports.default = () => createBundler(customizeWebpackConfig);
