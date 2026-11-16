import {createRequire} from 'node:module'
import {cp,mkdir} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const require=createRequire(import.meta.url)
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const source=dirname(require.resolve('wot-design-uni/package.json'))
const target=resolve(root,'src/uni_modules/wot-design-uni')
await mkdir(target,{recursive:true})
await cp(resolve(source,'components'),resolve(target,'components'),{recursive:true,force:true})
await cp(resolve(source,'locale'),resolve(target,'locale'),{recursive:true,force:true})
await cp(resolve(source,'dayjs'),resolve(target,'dayjs'),{recursive:true,force:true})
await cp(resolve(source,'LICENSE'),resolve(target,'LICENSE'),{force:true})
await cp(resolve(source,'package.json'),resolve(target,'package.json'),{force:true})
console.log('Wot Design Uni 已从锁定的 npm 依赖同步到应用内组件目录。')
