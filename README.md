<p align="center"><img src="src/assets/logo-mark.png" width="96" alt="T-Music"></p>

# T-Music

개인적으로 사용하려 만든 광고 없는 음악 재생 앱입니다. 음원은 YouTube에서 스트리밍하고, 보라색 로고에 맞춘 글래스 UI와 3D 모션으로 만들었습니다.

> 개인 학습·사용 목적의 프로젝트입니다. YouTube 서비스 약관상 공식 플레이어 밖에서 재생하는 것은 허용되지 않으므로, 상업적으로 이용하거나 배포하지 마세요.

## 기능

- **광고 없는 스트리밍**: 로그인 불필요, 다음 곡 미리 버퍼링, 마우스를 올리면 음원 주소 미리 받기
- **다운로드(오프라인 재생)**: 곡·앨범·플레이리스트 단위 저장, 진행률 표시, 인터넷 없이 재생
- **검색**: 검색어와 관련 없는 결과 제외, 공식 음원 우선 정렬, 자동 완성, 최근 검색
- **홈 대시보드**: 3D 커버플로우 추천, 빠른 재생, 분위기별 바로가기, 주간 청취 통계
- **지금 재생 패널**: 3D 틸트 앨범 아트, 실시간 오디오 비주얼라이저, 다음 곡과 대기열
- **전체 화면 무대**: 턴테이블(바깥 홈에서 안쪽으로 움직이는 톤암, 베이스에 반응하는 조명)과 카세트 데크(감기는 릴, VU 미터) 중 선택, 다음 곡 표시
- **시작·끝 효과음**: 처음 재생할 때와 대기열이 모두 끝날 때 데크 소리가 음악과 이어짐. 설정에서 끌 수 있고, 같이 듣기에서는 방장의 설정을 따름
- **싱크 가사**: LRCLIB, NetEase, QQ 뮤직, Kugou, 영상 자막을 자동 검색하고 곡 길이로 검증, 직접 고르기, 음원을 분석해 가사 위치를 맞추는 재싱크
- **Discord 활동 상태**: 듣고 있는 곡 표시
- **계정**: Google 또는 게스트 로그인. 플레이리스트, 좋아요, 앨범, 팔로우, 청취 기록, 최근 재생·검색이 계정에 저장되고 다른 PC에서도 이어짐
- **같이 듣기**: 초대 코드나 링크로 들어와 같은 곡을 같은 위치로 재생, 공유 대기열, 함께 보는 싱크 가사(재싱크와 직접 찾은 가사도 모두에게 적용), 조작 권한 설정, 멤버 바로 친구 추가, 추방, 방장 승계. 방은 멤버가 나가기 전까지 유지됨
- **취향 추천**: 청취 기록으로 만드는 오늘의 믹스와 자주 듣는 가수 추천
- **플레이리스트 공유**: 링크로 공유하고 같이 편집
- **미니 플레이어**: 항상 위에 떠 있는 작은 창
- **재생목록 가져오기**: YouTube나 YouTube Music의 공개 재생목록 링크를 보관함에 내 플레이리스트로 저장
- **친구**: 친구 코드로 추가, 온라인 여부와 듣는 곡 보기(설정에서 끌 수 있음), 바로 같이 듣기 초대
- **보관함**: 좋아요, 내 플레이리스트, 앨범 저장, 아티스트 팔로우, 백업과 복원
- 셔플, 반복, 자동 재생 라디오, Windows 미디어 키, 단축키

## 설치

[Releases](../../releases)에서 `T-Music-Setup-x.y.z.exe`를 받아 실행하세요. 관리자 권한 없이 설치되고, 마지막 화면에서 바탕화면 바로가기를 만들지 고를 수 있습니다.

코드 서명 인증서가 없어서 처음 실행할 때 Windows SmartScreen 경고가 뜰 수 있습니다. **추가 정보 → 실행**을 누르면 됩니다.

Android는 `android-v`로 시작하는 릴리즈에서 `T-Music-Android-x.y.z.apk`를 받아 설치하세요. Android 8.0 이상이 필요하고, 처음 설치할 때 출처를 알 수 없는 앱 허용을 물어봅니다.

## 재생 방식

`<audio src="ytm://stream/VIDEO_ID">` 요청을 Electron 메인 프로세스가 받아 처리합니다. 다운로드한 곡은 디스크에서 바로 보내고, 그 밖의 곡은 실제 음원 주소로 바꿔 1MB씩 나눠 받아 중계합니다. 유튜브는 한 번에 길게 받는 요청의 속도를 제한하기 때문입니다. YouTube 플레이어를 쓰지 않으므로 광고가 끼어들 곳이 없습니다.

음원 주소는 InnerTube의 visionOS 클라이언트로 얻습니다. 주소가 만료되면 새로 받아 이어서 재생합니다. 실패하면 iOS와 Android VR 클라이언트를 시도하지만, 이 둘은 현재 파일 앞부분만 내주기 때문에 검사에서 걸러집니다.

Android에서는 같은 코드를 WebView에서 실행하고, `/stream/VIDEO_ID` 요청을 Java 쪽이 받아 중계합니다. 다른 앱이 접근할 수 있는 포트는 열지 않습니다.

## 계정과 같이 듣기

Firebase를 씁니다. 계정 데이터는 Firestore, 같이 듣기 방은 Realtime Database에 있습니다. 같이 듣기는 음원을 공유하지 않습니다. 방에는 곡과 재생 위치, 서버 시각만 올라가고 각자 자기 PC에서 받아 재생하며, 오차가 작으면 재생 속도를 살짝 조절하고 크면 위치를 옮겨 맞춥니다.

직접 빌드하려면 다음이 필요합니다.

1. `src/lib/firebase.js`의 설정을 내 Firebase 프로젝트로 바꾸고, Authentication의 익명과 Google 로그인을 켭니다.
2. `firestore.rules`와 `database.rules.json`을 각 데이터베이스의 규칙으로 게시합니다.
3. Google Cloud에서 데스크톱 앱 유형 OAuth 클라이언트를 만들고, `electron/auth.config.example.json`을 `electron/auth.config.json`으로 복사해 값을 채웁니다. 이 파일은 저장소에 올리지 않습니다.

## 가사

가사는 아래 곳에서 찾아 제목, 가수, 곡 길이가 맞는 것만 씁니다. 곡 제목과 가수 이름이 각 서비스로 전송되며, NetEase, QQ 뮤직, Kugou는 공개 API가 아니어서 언제든 막힐 수 있습니다.

1. LRCLIB, NetEase, QQ 뮤직, Kugou의 타임스탬프 가사
2. 영상에 올라온 자막 (자동 생성 자막 제외)
3. YouTube Music, 네이버의 일반 가사 (싱크 없음)

뮤직비디오처럼 음원보다 긴 영상은 가사 시간이 맞지 않을 수 있어서, 자막이 없으면 일반 가사로 표시합니다.

## 개발

```bash
npm install
npm run dev      # 개발 모드 (Vite + Electron)
npm run dist     # Windows 설치 파일 생성 → release/
npm run android  # Android APK 생성 → release/ (Android SDK와 JDK 필요, Gradle은 쓰지 않음)
```

Android 릴리즈 서명 키는 처음 빌드할 때 `android/release.keystore`로 만들어지고 암호는 `android/keystore.properties`에 저장됩니다. 둘 다 저장소에 올리지 않습니다. 잃어버리면 이미 설치된 앱을 업데이트할 수 없으니 따로 백업해 두세요.

Android 릴리즈는 `android-vX.Y.Z` 태그에 `--latest=false`로 올립니다. Windows 앱은 저장소의 최신 릴리즈를 보고 업데이트하기 때문에, 최신으로 표시되면 Windows 앱 업데이트가 깨집니다.

```bash
gh release create android-vX.Y.Z release/T-Music-Android-X.Y.Z.apk --latest=false --target main --draft
gh workflow run android-release-check.yml -f tag=android-vX.Y.Z   # 올린 APK를 실제 Android에서 열어 봄
gh release edit android-vX.Y.Z --draft=false --latest=false
```

## 구조

```
android/                Android 앱 (WebView, 스트림 중계, 재생 알림, 다운로드, 업데이트)
build/                  설치 프로그램 리소스 (아이콘, 설치 화면 이미지, NSIS 확장)
electron/
  main.js               창, IPC
  protocol.js           ytm:// 스트림 프로토콜 (로컬 파일 / 원격 중계)
  downloads.js          다운로드 큐와 오프라인 보관
  auth.js               구글 로그인 (시스템 브라우저)
  discord.js            Discord 활동 상태
  updater.js            GitHub 릴리즈 업데이트
  preload.cjs
  lyrics/
    index.js            가사 검색 순서, 캐시, 후보 목록
    sources.js          가사 출처별 요청
    match.js            제목·가수 정리와 후보 채점
    lrc.js              LRC 파싱과 정리
  youtube/
    client.js           InnerTube 세션
    parse.js            원본 응답 파서 (라이브러리 파서에 의존하지 않음)
    catalog.js          검색, 앨범, 아티스트, 재생목록, 추천, 홈
    relevance.js        검색어와 결과의 관련도 계산
    stream.js           음원 주소 확보와 캐시
src/
  assets/               로고
  components/           공용 컴포넌트 (트랙 목록, 카드, 커버플로우, 비주얼라이저 등)
  android/              Android에서 Electron 메인 프로세스 역할을 하는 코드
  components/layout/    사이드바, 상단바, 플레이어 독, 지금 재생 패널, 가사, 턴테이블, 전체 화면 무대
  components/mobile/    Android 화면 (하단 탭, 미니 플레이어, 전체 화면 플레이어, 바텀시트)
  views/                페이지 (홈, 검색, 아티스트, 앨범·플레이리스트, 보관함, 다운로드, 설정)
  store/                상태 (재생, 보관함, 계정, 같이 듣기, 다운로드, 화면, 내비게이션)
  lib/                  API, Firebase, 보관함 동기화, 모션(anime.js), Web Audio, 유틸
  styles/               디자인 토큰과 스타일
```
