const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const { execSync } = require('child_process');

// Get version info at build time
const packageJson = require('./package.json');
const gitHash = execSync('git rev-parse --short HEAD').toString().trim();

module.exports = {
  mode: 'development',
  devtool: 'source-map',
  entry: {
    background: './src/background/index.ts',
    content: './src/content/index.tsx',
    popup: './src/popup/index.tsx',
    sidebar: './src/sidebar/index.tsx',
    options: './src/options/index.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
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
    }),
    new HtmlWebpackPlugin({
      template: './public/popup.html',
      filename: 'popup/index.html',
      chunks: ['popup'],
    }),
    new HtmlWebpackPlugin({
      template: './public/sidebar.html',
      filename: 'sidebar/index.html',
      chunks: ['sidebar'],
    }),
    new HtmlWebpackPlugin({
      template: './public/options.html',
      filename: 'options/index.html',
      chunks: ['options'],
    }),
    new CopyPlugin({
      patterns: [
        { from: 'public/manifest.json', to: 'manifest.json' },
        { from: 'public/icons', to: 'icons' },
        { from: '_locales', to: '_locales' },
      ],
    }),
  ],
};
