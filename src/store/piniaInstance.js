import { createPinia } from 'pinia'
import piniaPluginPersist from 'pinia-plugin-persist'
//所有需要使用到pinia的地方都引用这一个实例，如果在main中初始化则在vue根组件外无法使用。
const pinia = createPinia()
pinia.use(piniaPluginPersist)
export default pinia
