const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const { execSync } = require('child_process');

// Get version info at build time
const packageJson = require('./package.json');
let gitHash = 'dev';
try {
  gitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // Fallback for restricted environments where spawning git is blocked.
  gitHash = process.env.GIT_HASH || 'dev';
}

module.exports = (env, argv) => {
  console.log('Building universal package (desktop + Android)');

  // Output directory for universal build
  const outputDir = 'dist';
  
  // Entry points include all pages for universal package
  const entry = {
    background: './src/background/index.ts',
    content: './src/content/index.tsx',
    options: './src/options/index.tsx',
    popup: './src/popup/index.tsx',
    mobile: './src/mobile/index.tsx',
  };

  // HTML plugins for all pages
  const htmlPlugins = [
    new HtmlWebpackPlugin({
      template: './public/options.html',
      filename: 'options/index.html',
      chunks: ['options'],
    }),
    new HtmlWebpackPlugin({
      template: './public/popup.html',
      filename: 'popup/index.html',
      chunks: ['popup'],
    }),
    new HtmlWebpackPlugin({
      template: './public/mobile/index.html',
      filename: 'mobile/index.html',
      chunks: ['mobile'],
    }),
  ];

  return {
    mode: 'development',
    devtool: 'source-map',
    entry,
    output: {
      path: path.resolve(__dirname, outputDir),
      filename: '[name]/index.js',
      clean: true,
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader'],
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@shared': path.resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [
      new webpack.DefinePlugin({
        'process.env.APP_VERSION': JSON.stringify(packageJson.version),
        'process.env.GIT_HASH': JSON.stringify(gitHash),
        '__PLATFORM__': JSON.stringify('universal'),
      }),
      ...htmlPlugins,
      new CopyPlugin({
        patterns: [
          // Copy universal manifest
          { 
            from: 'public/manifest.json',
            to: 'manifest.json'
          },
          { from: 'public/icons', to: 'icons' },
          { from: '_locales', to: '_locales' },
        ],
      }),
    ],
  };
};
