import resolve from 'rollup-plugin-node-resolve'
import commonjs from 'rollup-plugin-commonjs'
import sourceMaps from 'rollup-plugin-sourcemaps'
import typescript from 'rollup-plugin-typescript2'
import json from 'rollup-plugin-json'
import { terser } from "rollup-plugin-terser"
import { visualizer } from 'rollup-plugin-visualizer'

const pkg = require('./package.json')

const libraryName = 'hal-normalizer-ts'

export default [{
  input: `src/${libraryName}.ts`,
  output: [
    { file: pkg.main, name: "normalize", format: 'umd', sourcemap: true },
    { file: pkg.module, format: 'es', sourcemap: true },
    {
      file: pkg.main.replace('umd.js', 'umd.min.js'), name: "normalize", format: 'umd', sourcemap: true, plugins: [terser({
        compress: { pure_funcs: ["console.log"] }
      })]
    },
    {
      file: pkg.module.replace('esm.js', 'esm.min.js'), format: 'es', sourcemap: true, plugins: [terser({

        compress: { pure_funcs: ["console.log"] }
      })]
    },
  ],
  // Indicate here external modules you don't wanna include in your bundle (i.e.: 'lodash')
  external: id => /lodash/.test(id),
  watch: {
    include: 'src/**',
  },
  plugins: [
    // Allow json resolution
    json(),
    // Compile TypeScript files
    typescript({ useTsconfigDeclarationDir: true }),
    // Allow bundling cjs modules (unlike webpack, rollup doesn't understand cjs)
    commonjs(),
    // Allow node_modules resolution, so you can use 'external' to control
    // which external modules to include in the bundle
    // https://github.com/rollup/rollup-plugin-node-resolve#usage
    resolve(),
    // Resolve source maps to the original source
    sourceMaps(),
    visualizer(),
  ],
},
{
  input: `src/${libraryName}.ts`,
  output: [
    { file: pkg.main.replace('umd.js', 'umd.full.js'), name: "normalize", format: 'umd', sourcemap: true },
  ],
  watch: {
    include: 'src/**',
  },
  plugins: [
    json(),
    typescript({ useTsconfigDeclarationDir: true }),
    commonjs(),
    resolve(),
    sourceMaps(),
  ],
}]
