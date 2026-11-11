/**
 * 설정 폴더를 예전 이름(pitwall)으로 고정하는 일만 하는 모듈. index.ts 의 맨 첫 import 여야 한다 — 다른 모듈이
 * 불러올 때 app.getPath('userData') 를 읽거나 단일 인스턴스 잠금을 잡기 전에 고정해야 한다(userData.test.ts 가 지킨다).
 * 번들러가 외부 의존성(electron-updater·@electron-toolkit/utils 등)의 require 를 이 모듈보다 위로 올릴 수 있지만, 그
 * 의존성들은 로드될 때 userData 를 읽지 않는다 — 새 외부 의존성을 더할 때는 로드될 때 userData 를 읽지 않는지 확인할 것.
 */
import { app } from 'electron'
import { join } from 'path'
import { pinUserData } from './userData'

pinUserData(app, join)
