# 산책 일기 (Walk Diary) — 구현 명세서

> 작성일: 2025-06-24 / 상태: 개발착수  
> 이 문서는 클로드코드가 이 프로젝트를 처음부터 구현할 때 필요한 모든 컨텍스트를 담고 있습니다.

---

## 0. 한 줄 정의

신생아를 키우는 부모가 아이와 산책할 때, 폰을 스트롤러에 고정하면 AI가 아이 눈높이에서 보이는 세상을 여자 음성으로 해설해주고, 산책이 끝나면 그날의 산책 일기를 자동으로 작성해주는 서비스.

---

## 1. 프로젝트 개요

- **타겟 유저**: 신생아~12개월 아이를 키우는 부모. 특히 아이가 뭘 보고 느끼는지 궁금하지만 알 수 없는 시기의 엄마/아빠.
- **핵심 가치 제안**:
  1. 아이 눈높이 카메라가 보이는 것을 AI가 실시간 해설 (여자 TTS 음성)
  2. 산책 종료 시 해설 전체를 취합해 날짜별 산책 일기 자동 생성
  3. 기록이 누적되어 아이의 첫 봄, 첫 비, 첫 강아지를 나중에 돌아볼 수 있음
- **왜 지금**: 100일 아이와 첫 산책을 기록하고 싶었던 아빠가 만드는 서비스. 유튜브 채널 첫 AI 빌딩 에피소드 소재.

---

## 2. 핵심 기능 명세

### MVP에 포함 (우선순위 순)

1. **산책 시작/종료 버튼**
   - 시작 누르면 카메라 스트림 활성화, 30초마다 자동 캡처 시작
   - 종료 누르면 캡처 중단, 일기 생성 API 호출

2. **실시간 AI 해설 (여자 TTS 음성)**
   - 30초마다 카메라 캡처 → Claude Vision 분석 → Azure TTS 여자 음성으로 재생
   - 해설 내용: 지금 보이는 것 + 100일 아이 발달 기준으로 어떤 자극인지
   - 예시: "나뭇잎이 바람에 흔들리고 있어요. 빛과 그림자가 교차하는 자극은 이 시기 아이가 가장 민감하게 반응하는 패턴이에요."

3. **카메라 뷰 + 해설 텍스트 표시**
   - 산책 중 화면에 카메라 스트림 표시
   - 최신 AI 해설 텍스트를 화면 하단에 자막처럼 표시
   - 해설 히스토리 (스크롤로 이전 것 볼 수 있음)

4. **산책 일기 자동 생성**
   - 종료 누르면 해설 전체를 Claude에게 넘겨 산책 일기 작성
   - 형식: 날짜, 날씨, 아이 나이(일수), 오늘 처음 본 것들, 일기 본문
   - 저장 후 일기 보기 화면으로 이동

5. **날짜별 일기 목록**
   - 홈 화면에 산책 일기 목록 (날짜, 썸네일 첫 캡처 이미지)
   - 탭해서 일기 전체 보기

### MVP에서 제외 (다음 단계)

- 하늘 전용 분석 탭 (하늘 일기): Phase 2
- 아이 표정 감지 및 반응 기록: Phase 2 (Vision 정확도 이슈)
- 누적 도감 기능 (처음 본 것들 모음): Phase 2
- 오디오 녹음 (주변 소리 기록): Phase 2
- 공유 기능: Phase 3
- 로그인/회원가입: MVP는 로컬 저장 또는 익명 세션으로 처리

---

## 3. 핵심 사용자 플로우

### 메인 플로우: 산책 시작 → 해설 → 일기 생성

```
1. 홈 화면에서 "산책 시작" 버튼 탭
2. 카메라 권한 요청 (첫 실행 시)
3. 카메라 뷰 화면 진입
   - 상단: 카메라 스트림 (라이브)
   - 하단: 최신 AI 해설 텍스트
   - 우측 상단: 경과 시간, 해설 횟수
4. 30초마다 자동으로:
   a. 현재 프레임 캡처 (canvas.toDataURL)
   b. /api/analyze 호출 (base64 이미지 전송)
   c. Claude Vision 분석 결과 수신
   d. /api/tts 호출 (해설 텍스트 → Azure TTS mp3)
   e. 오디오 재생 + 텍스트 자막 표시
   f. Supabase observations 테이블에 저장
5. "산책 종료" 버튼 탭
6. /api/diary 호출 (전체 observations 전달)
7. Claude가 산책 일기 생성 (10~15초 소요)
8. 생성된 일기 저장 → 일기 보기 화면으로 이동
```

### 보조 플로우: 일기 보기

```
1. 홈 화면 → 날짜별 일기 목록
2. 일기 탭 → 전체 내용 보기
   - 날짜, 아이 나이, 날씨
   - 일기 본문
   - 해설 타임라인 (시간별 what was seen)
   - 캡처 이미지 썸네일들
```

---

## 4. 기술 스택

| 영역 | 기술 | 선택 이유 |
|------|------|-----------|
| 프론트엔드 | Next.js 14 (App Router) + TypeScript | 형님 주력 스택 |
| 스타일링 | Tailwind CSS | 빠른 모바일 UI |
| PWA | next-pwa | 모바일 홈 화면 추가, 카메라 접근 |
| 데이터베이스 | Supabase (PostgreSQL) | 형님 주력 스택, RLS 내장 |
| AI Vision | Anthropic Claude claude-haiku-4-5-20251001 (Vision) | 저렴 ($0.0008/img), 한국어 해설 품질 좋음 |
| AI 일기 생성 | Anthropic Claude claude-sonnet-4-6 | 긴 텍스트 생성 품질 |
| TTS | Azure Cognitive Services TTS | 형님 기존 계정 있음, 한국어 여자 음성 고품질 (ko-KR-SunHiNeural) |
| 배포 | Vercel | 형님 주력 스택 |
| 이미지 저장 | Cloudflare R2 | 형님 주력 스택, 캡처 이미지 저장 |

### TTS 음성 설정

```
언어: ko-KR
음성: ko-KR-SunHiNeural (밝고 따뜻한 여자 음성)
스타일: friendly (Azure 스타일 파라미터)
속도: 0.9 (약간 천천히, 산책 분위기에 맞게)
```

---

## 5. 데이터 모델

```prisma
// Supabase에서 직접 SQL로 생성 (Prisma 미사용 시 아래 SQL 참고)

model Walk {
  id          String        @id @default(cuid())
  date        DateTime      @default(now())
  startTime   DateTime
  endTime     DateTime?
  babyAgeDays Int           // 아이 나이 (일수) - 수동 입력 또는 설정에서
  weather     String?       // 날씨 (나중에 API 연동 or 수동)
  diary       String?       // 생성된 산책 일기 본문
  diaryStatus String        @default("pending") // pending | generating | done | failed
  observations Observation[]
  createdAt   DateTime      @default(now())
}

model Observation {
  id          String   @id @default(cuid())
  walkId      String
  walk        Walk     @relation(fields: [walkId], references: [id])
  timestamp   DateTime @default(now())
  elapsedSec  Int      // 산책 시작 후 몇 초 지점
  imageUrl    String?  // Cloudflare R2 URL (캡처 이미지)
  description String   // AI 해설 텍스트
  audioUrl    String?  // Azure TTS mp3 URL (R2 저장)
  createdAt   DateTime @default(now())
}

model BabySettings {
  id          String   @id @default("singleton")
  birthDate   DateTime // 아이 생년월일 → ageDays 자동 계산용
  babyName    String   @default("아가")
  updatedAt   DateTime @updatedAt
}
```

```sql
-- Supabase SQL Editor에서 직접 실행
CREATE TABLE walks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date TIMESTAMPTZ DEFAULT now(),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  baby_age_days INT,
  weather TEXT,
  diary TEXT,
  diary_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE observations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  walk_id TEXT REFERENCES walks(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ DEFAULT now(),
  elapsed_sec INT,
  image_url TEXT,
  description TEXT NOT NULL,
  audio_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE baby_settings (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  birth_date DATE NOT NULL,
  baby_name TEXT DEFAULT '아가',
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. 시스템 아키텍처

```
[모바일 브라우저 (PWA)]
  └─ getUserMedia → canvas 캡처 (30초 간격)
  └─ base64 이미지 → POST /api/analyze
  └─ 해설 텍스트 수신 → POST /api/tts
  └─ mp3 URL 수신 → Audio 재생
  └─ POST /api/walk/observations (해설 저장)
  └─ 종료 시 POST /api/walk/[id]/diary

[Next.js API Routes (Vercel)]
  ├─ /api/analyze
  │   └─ Claude Vision API (claude-haiku-4-5-20251001)
  │   └─ 이미지 → R2 업로드 (비동기)
  │   └─ 해설 텍스트 반환
  │
  ├─ /api/tts
  │   └─ Azure Cognitive Services TTS
  │   └─ mp3 → R2 업로드
  │   └─ mp3 URL 반환
  │
  ├─ /api/walk/observations
  │   └─ Supabase observations INSERT
  │
  └─ /api/walk/[id]/diary
      └─ observations 전체 조회
      └─ Claude claude-sonnet-4-6 (일기 생성)
      └─ Supabase walks UPDATE (diary, diary_status)

[Supabase] ← walks, observations, baby_settings
[Cloudflare R2] ← 캡처 이미지, TTS mp3
```

---

## 7. 외부 연동 & API

| 서비스 | 용도 | 인증 방식 | 요금/제약 | 실패 시 처리 |
|--------|------|-----------|-----------|--------------|
| Claude API (Haiku) | 이미지 Vision 분석 | ANTHROPIC_API_KEY | ~$0.0008/캡처, 30분 산책 ≈ ₩65 | 에러 시 "잠시 주변을 감상해요" 기본 해설 |
| Claude API (Sonnet) | 산책 일기 생성 | 동일 | ~$0.01/일기 | 재시도 버튼 노출 |
| Azure TTS | 여자 음성 합성 | AZURE_TTS_KEY + REGION | 무료 500만 chars/월 | 텍스트만 표시, 음성 스킵 |
| Supabase | DB | SUPABASE_URL + ANON_KEY | 무료 플랜 | 로컬 캐시 후 재전송 |
| Cloudflare R2 | 이미지/오디오 저장 | CF_ACCESS_KEY + SECRET | 무료 10GB/월 | 저장 실패 시 URL null로 저장 |

### Claude Vision 프롬프트 (analyze API)

```typescript
const SYSTEM_PROMPT = `
당신은 신생아와 함께 산책하는 부모를 위한 AI 해설가입니다.
스트롤러에 설치된 카메라가 아이 눈높이에서 본 세상을 캡처했습니다.
아이 나이: ${babyAgeDays}일

다음 형식으로 응답하세요 (JSON):
{
  "description": "지금 보이는 것을 설명 (1~2문장, 따뜻하고 친근한 말투)",
  "babyPerspective": "이 자극이 이 나이 아이에게 어떤 의미인지 (1문장)",
  "firstThings": ["처음 등장한 요소들 (빈 배열 가능)"]
}

예시:
{
  "description": "나뭇잎이 바람에 살랑살랑 흔들리고 있어요. 햇빛이 잎사귀 사이로 비치고 있어요.",
  "babyPerspective": "빛과 그림자가 교차하는 자극은 이 시기 아이가 가장 민감하게 반응하는 패턴이에요.",
  "firstThings": ["나뭇잎", "햇빛"]
}

JSON만 응답하세요. 마크다운 코드블록 없이.
`;
```

### Claude 일기 생성 프롬프트 (diary API)

```typescript
const DIARY_PROMPT = `
오늘 ${babyName}와 함께한 산책 기록입니다.
날짜: ${date}
아이 나이: ${babyAgeDays}일 (${Math.floor(babyAgeDays/30)}개월 ${babyAgeDays%30}일)
산책 시간: ${duration}분
날씨: ${weather || '맑음'}

[산책 중 관찰된 것들]
${observations.map((o, i) => `${i+1}. [${o.elapsedSec}초] ${o.description} ${o.babyPerspective}`).join('\n')}

위 기록을 바탕으로 따뜻하고 감성적인 산책 일기를 작성해주세요.
- 아이의 시점에서 세상을 바라보는 느낌을 담아주세요
- 오늘 처음 경험한 것들을 언급해주세요
- 300~400자 분량
- 일기 형식 (날짜 헤더 없이 본문만)
`;
```

---

## 8. 환경 변수

```bash
# Anthropic
ANTHROPIC_API_KEY=              # anthropic.com API 키

# Supabase
NEXT_PUBLIC_SUPABASE_URL=       # 프로젝트 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # anon public 키
SUPABASE_SERVICE_ROLE_KEY=      # service role (서버에서만)

# Azure TTS
AZURE_TTS_KEY=                  # Azure Portal → Cognitive Services
AZURE_TTS_REGION=               # 예: koreacentral

# Cloudflare R2
CF_ACCOUNT_ID=
CF_ACCESS_KEY_ID=
CF_SECRET_ACCESS_KEY=
CF_R2_BUCKET_NAME=walk-diary
CF_R2_PUBLIC_URL=               # 예: https://pub-xxx.r2.dev
```

---

## 9. 폴더 구조

```
walk-diary/
├── app/
│   ├── page.tsx                    # 홈 - 산책 일기 목록
│   ├── walk/
│   │   ├── active/
│   │   │   └── page.tsx            # 산책 중 화면 (카메라 + 해설)
│   │   └── [id]/
│   │       └── page.tsx            # 산책 일기 보기
│   ├── settings/
│   │   └── page.tsx                # 아이 생년월일, 이름 설정
│   └── api/
│       ├── analyze/
│       │   └── route.ts            # POST: 이미지 → Claude Vision → 해설 텍스트
│       ├── tts/
│       │   └── route.ts            # POST: 텍스트 → Azure TTS → mp3 URL
│       ├── walk/
│       │   ├── route.ts            # POST: 새 산책 생성
│       │   └── [id]/
│       │       ├── observations/
│       │       │   └── route.ts    # POST: observation 저장
│       │       └── diary/
│       │           └── route.ts    # POST: 일기 생성
│       └── settings/
│           └── route.ts            # GET/PUT: 아기 설정
├── components/
│   ├── WalkCamera.tsx              # 카메라 스트림 + 캡처 로직
│   ├── WalkControls.tsx            # 시작/종료 버튼 + 타이머
│   ├── ObservationFeed.tsx         # 해설 히스토리 스크롤
│   ├── DiaryView.tsx               # 일기 보기 컴포넌트
│   └── DiaryList.tsx               # 홈 일기 목록
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # 브라우저용 클라이언트
│   │   └── server.ts               # 서버용 클라이언트
│   ├── claude.ts                   # Anthropic SDK 초기화
│   ├── tts.ts                      # Azure TTS 유틸
│   ├── r2.ts                       # R2 업로드 유틸
│   └── camera.ts                   # getUserMedia + canvas 캡처 유틸
├── hooks/
│   ├── useCamera.ts                # 카메라 스트림 관리
│   ├── useWalkSession.ts           # 산책 세션 상태 관리
│   └── useAudio.ts                 # TTS 오디오 재생 관리
├── types/
│   └── index.ts
├── public/
│   ├── manifest.json               # PWA 매니페스트
│   └── icons/                      # PWA 아이콘
├── next.config.ts
├── tailwind.config.ts
└── .env.local
```

---

## 10. 핵심 비즈니스 로직 & 알려진 리스크

### 카메라 캡처 핵심 로직

```typescript
// lib/camera.ts
export async function captureFrame(videoElement: HTMLVideoElement): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;   // 너무 크면 API 비용 증가
  canvas.height = 480;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(videoElement, 0, 0, 640, 480);
  return canvas.toDataURL('image/jpeg', 0.7); // 품질 0.7로 압축
}

// hooks/useWalkSession.ts
// 30초 인터벌로 캡처 → 분석 → TTS 재생
useEffect(() => {
  if (!isWalking) return;
  const interval = setInterval(async () => {
    const base64 = await captureFrame(videoRef.current!);
    const { description, babyPerspective } = await analyzeImage(base64);
    const audioUrl = await generateTTS(`${description} ${babyPerspective}`);
    await playAudio(audioUrl);
    await saveObservation({ description, babyPerspective, audioUrl });
  }, 30000); // 30초
  return () => clearInterval(interval);
}, [isWalking]);
```

### Azure TTS SSML 형식

```typescript
// lib/tts.ts
export function buildSSML(text: string): string {
  return `
    <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ko-KR">
      <voice name="ko-KR-SunHiNeural">
        <prosody rate="0.9" pitch="+0%">
          ${text}
        </prosody>
      </voice>
    </speak>
  `;
}
```

### 리스크 목록

1. **iOS Safari 카메라 접근 제한**
   - iOS 14.3 미만에서는 PWA에서 getUserMedia 불가
   - 대응: 최소 iOS 14.3 이상 안내 문구, Safari 최신 버전 권장

2. **화면이 꺼지면 카메라 중단됨**
   - 모바일 브라우저에서 화면 잠금 시 백그라운드 카메라 접근 불가
   - 대응: WakeLock API로 화면 꺼짐 방지 (`navigator.wakeLock.request('screen')`)
   - WakeLock도 iOS에서 지원 제한됨 → iOS용 안내 문구 ("화면이 꺼지지 않도록 해주세요")

3. **API 응답 지연 (30초 안에 분석+TTS 완료 필요)**
   - Claude Haiku Vision: 보통 2~4초
   - Azure TTS: 보통 1~2초
   - 총 5~6초면 30초 인터벌에서 충분
   - 대응: 15초 타임아웃, 실패 시 이전 해설 재사용

4. **R2 업로드 실패**
   - 산책 중 인터넷 불안정 시 이미지 업로드 실패 가능
   - 대응: 이미지 URL은 null 허용, 해설 텍스트만 필수 저장

5. **배터리 소모**
   - 카메라 + 인터넷 + 오디오 동시 사용으로 배터리 빠름
   - 대응: MVP에서는 명시하지 않음, 나중에 저전력 모드 옵션 추가

6. **일기 생성 시간 (10~15초)**
   - 종료 후 바로 일기가 안 나옴
   - 대응: 로딩 화면에 "일기를 쓰고 있어요..." 문구 + 진행 애니메이션

---

## 11. 디자인/UX 방향

- **톤**: 따뜻하고 감성적. 육아 앱 느낌. 흰 배경, 파스텔 계열.
- **폰트**: Noto Sans KR (한국어 가독성)
- **주요 색상**:
  - 메인: `#7BC8A4` (민트 그린 — 자연/산책 느낌)
  - 배경: `#FAFAF8`
  - 텍스트: `#2D2D2D`
- **산책 중 화면 레이아웃**:
  ```
  ┌─────────────────────┐
  │   카메라 스트림     │  ← 화면 상단 2/3
  │   (라이브)          │
  ├─────────────────────┤
  │ 🌿 나뭇잎이 흔들리고│  ← 최신 해설 텍스트
  │ 있어요...           │
  ├─────────────────────┤
  │ ⏱ 00:32  📸 1회   │  ← 경과 시간, 해설 횟수
  │ [   산책 종료   ]  │  ← 종료 버튼
  └─────────────────────┘
  ```
- **일기 화면**: 손으로 쓴 듯한 노트 느낌, 날짜 + 날씨 아이콘 + 본문

---

## 12. 수익모델

MVP는 수익화 없음. 개인 프로젝트 / 유튜브 콘텐츠 소재.

추후 고려 (Phase 3):
- 무료: 월 4회 산책 일기
- Pro ₩3,900/월: 무제한 + 일기 내보내기 (PDF)
- 가족 ₩6,900/월: 여러 아이 프로필

---

## 13. 법적/컴플라이언스

- **아이 이미지 저장**: R2에 저장되는 캡처 이미지에 아이 얼굴이 포함될 수 있음
  - MVP: 개인 사용 목적이므로 문제없음
  - 서비스화 시: PIPA 기반 개인정보처리방침 필요, 특히 미성년자 이미지 관련
- **개인정보 수집**: 이름(선택), 생년월일(아이 나이 계산용) — 수집 최소화
- **겸업 이슈**: 현재 수익화 없는 개인 프로젝트로 운영

---

## 14. 구현 로드맵

### Phase 1: 코어 기능 (목표: 산책 한 번 돌릴 수 있는 수준)

- [ ] Next.js 프로젝트 셋업 (TypeScript + Tailwind + PWA)
- [ ] Supabase 테이블 생성 (walks, observations, baby_settings)
- [ ] 설정 화면 (아이 생년월일, 이름 입력 → baby_settings 저장)
- [ ] 카메라 화면 기본 구현 (getUserMedia + 스트림 표시)
- [ ] WakeLock API 적용 (화면 꺼짐 방지)
- [ ] `/api/analyze` 구현 (이미지 → Claude Haiku Vision → JSON 반환)
- [ ] `/api/tts` 구현 (텍스트 → Azure TTS → mp3)
- [ ] 30초 캡처 인터벌 + 해설 재생 훅 구현
- [ ] 해설 텍스트 자막 표시
- [ ] 산책 시작/종료 버튼 + 타이머
- [ ] observation Supabase 저장

**완료 기준**: 30분 테스트 산책에서 해설이 정상 재생되고 observations가 DB에 저장됨

### Phase 2: 일기 생성 (목표: 산책 일기 보기)

- [ ] `/api/walk/[id]/diary` 구현 (observations → Claude Sonnet → 일기)
- [ ] 종료 버튼 누르면 일기 생성 호출 + 로딩 화면
- [ ] 일기 보기 화면 (본문 + 해설 타임라인)
- [ ] 홈 화면 (일기 목록)
- [ ] R2 이미지 업로드 (캡처 이미지 저장)
- [ ] 날씨 자동 감지 (OpenWeatherMap API 또는 수동 선택)

**완료 기준**: 산책 종료 후 일기가 생성되어 홈에서 볼 수 있음

### Phase 3: 완성도 + 유튜브 영상용

- [ ] 하늘 전용 분석 탭
- [ ] "오늘 처음 본 것들" 도감 기능
- [ ] 일기 공유 (이미지로 저장)
- [ ] 누적 통계 (총 산책 횟수, 총 해설 수)
- [ ] 오프라인 기본 동작 (해설 없이 기록만)

---

## 15. 미해결 질문 (확인 필요)

- [ ] **캡처 간격**: 30초가 적당한지, 더 짧게 (15초) 또는 더 길게 (60초) 할지 → 배터리/비용 트레이드오프
- [ ] **이미지 저장 여부**: 캡처 이미지를 R2에 항상 저장할지, 선택적으로 저장할지 (개인정보 + 비용 고려)
- [ ] **날씨 연동**: OpenWeatherMap API 쓸지, 아니면 수동 선택 버튼으로 할지 (맑음/흐림/비/바람)
- [ ] **iOS 테스트**: 개발 디바이스가 iOS인지 Android인지 (WakeLock + 카메라 동작 차이 있음)
- [ ] **아이 이름 기본값**: 코드에서 "아가"를 기본값으로 쓸지 다른 표현으로 할지

---

## 16. 클로드코드 활용 가이드

이 문서를 Claude Code에 붙여넣고 아래 프롬프트로 시작하세요:

```
이 문서를 참고해서 walk-diary 프로젝트를 구현해줘.
Phase 1부터 시작해서 순서대로 진행해줘.
기술 스택은 문서에 명시된 대로 (Next.js 14, Supabase, Azure TTS, Claude API).
첫 번째로 프로젝트 셋업과 Supabase 테이블 생성부터 해줘.
```

**주의사항**:
- 카메라 기능은 반드시 HTTPS 환경에서만 동작함 (localhost 제외)
- Vercel 배포 후 테스트 권장
- Azure TTS `ko-KR-SunHiNeural` 음성은 Azure Portal에서 Speech Service 리소스 생성 필요
