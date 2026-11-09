// 한글 글꼴 Pretendard(OFL-1.1, https://github.com/orioncactus/pretendard) — 앱에 넣어 Windows·macOS 가 같게 보인다.
import 'pretendard/dist/web/variable/pretendardvariable.css'
import './styles/app.css'

import { createApp } from 'vue'
import App from './App.vue'
import TrayView from './TrayView.vue'

// 트레이 요약 창은 같은 화면 파일을 ?view=tray 로 연다(F10).
const tray = new URLSearchParams(location.search).get('view') === 'tray'
createApp(tray ? TrayView : App).mount('#app')
