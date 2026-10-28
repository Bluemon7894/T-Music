# T-Music

제가 쓰려 만든 광고 없는 음악 재생 앱입니다. 스포티파이 스타일 UI로 만들었고, 음원은 YouTube에서 스트리밍합니다.

> 개인 학습·사용 목적의 프로젝트입니다. YouTube 서비스 약관상 공식 플레이어 밖에서 재생하는 것은 허용되지 않으므로, 상업적으로 이용하거나 배포하지 마세요.

## 기능

- 노래·아티스트·앨범·플레이리스트 검색 (공식 음원 우선)
- 앨범, 아티스트, YouTube 재생목록 페이지
- 좋아요, 내 플레이리스트, 앨범 저장, 아티스트 팔로우 (이 PC에만 저장, 로그인 불필요)
- YouTube 재생목록 가져오기
- 대기열, 셔플, 반복, 자동 재생(비슷한 곡 이어서 재생)
- 다음 곡 미리 버퍼링, 마우스를 올리면 음원 주소 미리 받기
- Windows 미디어 키와 미디어 오버레이 연동
- 라이브러리 백업과 복원

## 재생 방식

`<audio src="ytm://stream/VIDEO_ID">` 요청을 Electron 메인 프로세스가 받아 실제 음원 주소로 바꾼 뒤 데이터를 중계합니다. YouTube 플레이어를 쓰지 않으므로 광고가 끼어들 곳이 없습니다.

음원 주소는 아래 방법을 순서대로 시도해서 얻습니다. 최근에 실패한 방법은 6시간 동안 뒤로 밀렸다가 다시 시도됩니다.

1. InnerTube (iOS 클라이언트)
2. InnerTube (Android VR 클라이언트)
3. InnerTube (visionOS 클라이언트)
4. yt-dlp (처음 실행할 때 내려받고 하루에 한 번 자동 업데이트)

만료된 주소는 자동으로 새로 받아오고, 재생 중이던 위치에서 이어서 재생합니다.

## 개발

```bash
npm install
npm run dev      # 개발 모드 (Vite + Electron)
npm run dist     # Windows 설치 파일 생성 → release/
```

## 구조

```
electron/
  main.js          창, ytm:// 스트림 프로토콜, IPC
  preload.cjs
  yt/client.js     InnerTube 세션
  yt/parse.js      원본 응답 파서 (라이브러리 파서에 의존하지 않음)
  yt/catalog.js    검색, 앨범, 아티스트, 재생목록, 추천
  yt/stream.js     음원 주소 확보 (대체 경로, 캐시, 실패 학습)
  yt/ytdlp.js      yt-dlp 내려받기와 업데이트
src/               React UI (Vite)
```
