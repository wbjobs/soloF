module.exports = {
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpg|gif|svg)$/,
        use: ['file-loader']
      },
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      "path": false,
      "fs": false
    }
  },
  output: {
    libraryTarget: 'commonjs2'
  },
  externals: [
    /^@jupyterlab\//,
    /^@lumino\//,
    /^@phosphor\//
  ]
};
