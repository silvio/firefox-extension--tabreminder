const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');
const { execSync } = require('child_process');

// Get version info at build time
const packageJson = require('./package.json');
const gitHash = execSync('git rev-parse --short HEAD').toString().trim();

module.exports = (env, argv) => {
  // Detect platform from environment variable
  // Usage: webpack --env platform=android or webpack --env platform=desktop
  const platform = env && env.platform ? env.platform : 'desktop';
  const isAndroid = platform === 'android';
  
  console.log(`Building for platform: ${platform}`);

  // Output directory based on platform
  const outputDir = isAndroid ? 'dist-android' : 'dist';
  
  // Entry points differ by platform
  const entry = {
    background: './src/background/index.ts',
    content: './src/content/index.tsx',
    options: './src/options/index.tsx',
  };
  
  // Desktop: include popup
  // Android: include mobile instead
  if (isAndroid) {
    entry.mobile = './src/mobile/index.tsx';
  } else {
    entry.popup = './src/popup/index.tsx';
  }

  // HTML plugins differ by platform
  const htmlPlugins = [
    new HtmlWebpackPlugin({
      template: './public/options.html',
      filename: 'options/index.html',
      chunks: ['options'],
    }),
  ];
  
  if (isAndroid) {
    // Android: mobile page
    htmlPlugins.push(
      new HtmlWebpackPlugin({
        template: './public/mobile/index.html',
        filename: 'mobile/index.html',
        chunks: ['mobile'],
      })
    );
  } else {
    // Desktop: popup
    htmlPlugins.push(
      new HtmlWebpackPlugin({
        template: './public/popup.html',
        filename: 'popup/index.html',
        chunks: ['popup'],
      })
    );
  }

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
        '__PLATFORM__': JSON.stringify(platform),
      }),
      ...htmlPlugins,
      new CopyPlugin({
        patterns: [
          // Copy correct manifest based on platform
          { 
            from: isAndroid ? 'public/manifest.android.json' : 'public/manifest.json',
            to: 'manifest.json'
          },
          { from: 'public/icons', to: 'icons' },
          { from: '_locales', to: '_locales' },
        ],
      }),
    ],
  };
};
