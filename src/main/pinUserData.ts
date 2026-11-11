/**
 * 설정 폴더를 예전 이름(pitwall)으로 고정하는 일만 하는 모듈. index.ts 의 맨 첫 import 여야 한다 — 다른 모듈이
 * 불러올 때 app.getPath('userData') 를 읽거나 단일 인스턴스 잠금을 잡기 전에 고정해야 한다(userData.test.ts 가 지킨다).
 */
import { app } from 'electron'
import { join } from 'path'
import { pinUserData } from './userData'

pinUserData(app, join)
