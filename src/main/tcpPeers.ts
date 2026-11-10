import type { TcpEntry } from '../shared/types'

/**
 * 연결된(Established) 소켓의 로컬 끝(주소|포트) → 그 소켓을 가진 pid. 같은 PC 안의 연결이면 상대 끝으로
 * 상대 프로세스를 찾을 수 있다(서버 트리 안의 프로세스가 자기 포트에 붙은 루프백 연결을 가려내는 데 쓴다).
 */
export function localEndpoints(tcp: TcpEntry[]): Map<string, number> {
  const owners = new Map<string, number>()
  for (const t of tcp)
    if (t.state === 'Established') owners.set(`${t.localAddress}|${t.localPort}`, t.pid)
  return owners
}

/** 연결의 상대 프로세스 pid. 같은 PC 안의 연결이 아니거나 모르면 null. */
export function peerPid(t: TcpEntry, owners: Map<string, number>): number | null {
  return owners.get(`${t.remoteAddress}|${t.remotePort}`) ?? null
}
