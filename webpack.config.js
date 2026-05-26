'use strict'

const webpack = require("webpack");
const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

const fileExtensions = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "eot",
  "otf",
  "svg",
  "ttf",
  "woff",
  "woff2",
];

const entryPoints = {
  background: path.join(__dirname, "src", "pages", "Background", "index.js"),
  contentScript: path.join(__dirname, "src", "pages", "Content", "index.tsx"),
  sidepanel: path.join(__dirname, "src", "pages", "Sidepanel", "index.tsx"),
  viewer: path.join(__dirname, "src", "pages", "Viewer", "index.tsx")
};

const htmlPlugins = Object.keys(entryPoints)
  .map((entryName) => {
    // Skip background script as it doesn't need an HTML file
    if (entryName === "background" || entryName === "contentScript") {
      return null;
    }

    // For sidepanel/viewer, use their HTML templates
    let htmlFileName = "index.html";
    if (entryName === "sidepanel") {
      htmlFileName = "Sidepanel/sidepanel.html";
    } else if (entryName === "viewer") {
      htmlFileName = "Viewer/viewer.html";
    } 

    const templatePath = path.join(
      __dirname,
      "src",
      "pages",
      htmlFileName
    );
    const options = {
      template: templatePath,
      filename: `${entryName}.html`,
      chunks: [entryName],
      cache: false,
    };
    options.favicon = path.join(__dirname, "src", "assets", "favicon.png");
    return new HtmlWebpackPlugin(options);
  })
  .filter(Boolean); 

const config = {
    mode: "development",
    entry: entryPoints,

    output: {
        filename: "[name].bundle.js", // 每个入口单独打包
        path: path.resolve(__dirname, "build"),
        clean: true, // 打包前清理 build 目录
        publicPath: "/", // 资源路径
    },

    module: {
        rules: [
            {
                test: /\.(css|scss)$/,
                use: [
                    { loader: "style-loader" },
                    { loader: "css-loader" },
                    {
                        loader: "sass-loader",
                        options: { sourceMap: true },
                    },
                ],
            },
            {
                test: new RegExp(`.(${fileExtensions.join("|")})$`),
                type: "asset/resource",
                exclude: /node_modules/,
            },
            {
                test: /\.html$/,
                loader: "html-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.(ts|tsx)$/,
                loader: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.(js|jsx)$/,
                exclude: /node_modules/,
                use: 'babel-loader'
            }
        ],
    },

    plugins: [
        new CleanWebpackPlugin({ verbose: false }),
        new webpack.ProgressPlugin(),
        new CopyWebpackPlugin({
            patterns: [
                {
                    from: "src/manifest.json",
                    to: path.join(__dirname, "build"),
                    force: true,
                    transform: (content) => {
                        return Buffer.from(
                        JSON.stringify({
                            description: process.env.npm_package_description,
                            version: process.env.npm_package_version,
                            ...JSON.parse(content.toString()),
                        })
                        );
                    },
                },
                {
                    from: "src/schema.json",
                    to: path.join(__dirname, "build/schema.json"),
                    force: true,
                },
                {
                    from: "src/assets/",
                    to: path.join(__dirname, "build/assets"),
                    force: true,
                },
                {
                    from: "src/_locales/",
                    to: path.join(__dirname, "build/_locales"),
                    force: true,
                },
                {
                    from: "src/pages/Content/bridge.js",
                    to: path.join(__dirname, "build/pageBridge.js"),
                    force: true,
                },
            ],
            }),
        ...htmlPlugins,
    ],

    devServer: {
        static: path.resolve(__dirname, 'build'),
        port: 8080,
        hot: true
    },

    resolve: {
        extensions: ['.js', '.tsx', '.jsx', '.ts', '.tsx', '.json']
    },
}

module.exports = config;
