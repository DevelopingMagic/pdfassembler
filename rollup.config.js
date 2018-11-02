import commonjs from 'rollup-plugin-commonjs'
import nodeResolve from 'rollup-plugin-node-resolve'

module.exports = {
  input: 'dist/pdfassembler.js',
  output: {
    file: 'dist/pdfassembler.umd.js',
    format: 'umd',
    name: 'pdfAssembler'
  },
  plugins: [
    nodeResolve({
      jsnext: true,
      main: true,
      module: true
    }),

    commonjs({
      // include: 'node_modules/**',  // Default: undefined
    })
  ]
}
