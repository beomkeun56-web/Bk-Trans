# Bk-Trans — 로컬 Claude Code 인수인계 문서

작성일: 2026-06-13
현재 버전: **v20.15t**
세션 인수자: 사용자의 로컬 Claude Code

---

## 1. 프로젝트 한 줄 요약

GitHub Pages에 호스팅된 한·중 양방향 번역 SPA. 단일 `index.html`(~7,200줄, 인라인 JS). 사용자 1명(beomkeun56)이 LeadTab 제조현장 + 일상 카톡 용도로 사용.

- 배포: https://beomkeun56-web.github.io/Bk-Trans/Bk-Trans-Test/
- 저장소: `git@github.com:beomkeun56-web/Bk-Trans.git`
- 메인 파일: `index.html` (작업) + `Bk-Trans-Test/index.html` (배포본, 항상 동일)
- 작업 브랜치: `claude/jolly-archimedes-bgU4L`
- 자동 머지: `claude/**` → `main` (GitHub Actions, `.github/workflows/auto-merge-claude.yml`)
- 배포: `main` 푸시 시 GitHub Pages 자동 빌드

---

## 2. 로컬 셋업 (한 번만)

```bash
# 클론
cd ~  # 또는 원하는 위치
git clone git@github.com:beomkeun56-web/Bk-Trans.git
cd Bk-Trans

# 작업 브랜치 체크아웃
git fetch origin
git checkout claude/jolly-archimedes-bgU4L
git pull origin claude/jolly-archimedes-bgU4L

# 또는 main에서 새 브랜치 만들어 작업해도 됨 (자동 머지가 잡아줌)
git checkout main && git pull
git checkout -b claude/new-feature-name
```

로컬 Claude Code 실행:
```bash
claude
```

---

## 3. 개발 표준 절차

매 변경마다 **반드시**:

```bash
# 1. index.html 편집
# 2. Bk-Trans-Test/index.html에 복사 (배포본 동기화 — 잊으면 배포 안 됨)
cp index.html Bk-Trans-Test/index.html

# 3. syntax check (인라인 JS)
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let i = 0;
for(const s of scripts){ i++; try{ new Function(s); } catch(e){ console.log('Script #' + i + ' error:', e.message); process.exit(1); } }
console.log('OK: ' + scripts.length + ' scripts');
"

# 4. APP_VERSION 상수 한 줄 bump (예: v20.15t → v20.16t)
#    grep -n "APP_VERSION = " index.html

# 5. 커밋 + 푸시
git add index.html Bk-Trans-Test/index.html
git commit -m "v20.16t: ..."
git push -u origin claude/jolly-archimedes-bgU4L
# auto-merge가 main으로 합쳐 → GitHub Pages 자동 배포 (1~2분)
```

---

## 4. 코드 아키텍처 (v20 재설계 후)

### 4.1 핵심 흐름 (단순화됨)
```
사용자 입력 → buildContextMessages → callOpenRouterStream → 결과 표시
                       ↓
            시스템 프롬프트에 자동 주입:
            [용어집] (매칭된 src만)
            [참고 예시] (TM 유사 쌍 top-4)
```

### 4.2 제거된 것 (v20.0t)
- 3st Agent Mode (Analyzer→Translator→Verifier)
- 2st Agent Mode (Qwen MT→Polish)
- Plan Mode (Analyzer→Translator)
- 모든 파이프라인 코드는 함수만 남아있고 UI에서 호출 안 됨 (마이그레이션 v_redesign으로 강제 OFF)

### 4.3 신규 핵심: Translation Memory (TM)

**저장 구조** (`LS.tmPairs` JSON 배열, 상한 2000):
```js
{
  src: "好的，我马上要去南京安排另一台车接你",
  tgt: "네, 제가 지금 난징으로 가야 해서 다른 차 한 대 배차해서 모시러 가겠습니다",
  grade: "gold" | "silver",     // gold=Edit 확정, silver=Copy
  guide: "존댓말로 ...",         // 교정 지침 (gold만)
  origTrans: "응, 내가 지금...",  // 거부된 원래 번역 (gold만, 학습용 negative example)
  ts: 1760000000000,
  hits: 0,
  srcLang: "zh"
}
```

**자동 수집**:
- Edit → "✓ Copy & 확정" 클릭 → **gold 저장** (4필드 모두)
- 일반 Copy 클릭 → silver 저장 (기본 OFF, TM 설정에서 ON 가능)

**자동 주입** (`buildTmExamplesBlock`):
- 매 번역 호출 전 `findSimilarPairs(input, k=4)` 실행
- 2-gram Jaccard 유사도 + gold 보너스(+0.10) + 최근 보너스(+0.05)
- 임계값 0.15 이상만, 같은 source lang만
- 결과를 system prompt 끝에 `[참고 예시]` 블록으로 첨부

### 4.4 핵심 함수 위치 (index.html 기준 라인 ±20)

| 기능 | 함수 | 대략 위치 |
|---|---|---|
| TM 저장 | `addTmPair(src, tgt, grade, guide, origTrans)` | 라인 ~3582 |
| TM 검색 | `findSimilarPairs(input, k)` | 라인 ~3670 |
| TM 예시 블록 | `buildTmExamplesBlock(input)` | 라인 ~3700 |
| 시스템 프롬프트 빌드 | `buildContextMessages(userText)` | 라인 ~3387 |
| TM 관리 UI | `showTmManager()` | 라인 ~6544 |
| Echo 감지 | `detectEcho(input, output)` | 라인 ~3760 |
| 폴백 호출 | `fallbackTranslate(userText, onChunk)` | 라인 ~3782 |
| Edit 팝업 열기 | `openEditGuide(src, trans, msgRef)` | 라인 ~4035 |
| Edit 재번역 핸들러 | `retryBtn` click handler | 라인 ~4159 |
| Edit Copy 확정 | `resultCopyBtn` click handler | 라인 ~4250 |
| 동음이의 감지 | `detectKoreanAmbiguity(text)` | 라인 ~3739 |
| 호출 본체 | `callOpenRouterStream(userText, onChunk)` | 라인 ~3940 |
| Refine 호출 | `callRefine(input, customSystem, onChunk, opts)` | 라인 ~3893 |
| 시스템 프롬프트 (Anthropic 캐싱) | `buildChatRequest` | 라인 ~3122 |
| Qwen 일반 오버라이드 | 같은 함수 내 `p === 'qwen'` 분기 | 라인 ~3180 |

### 4.5 주요 LS 키 (모두 `bk_tr_test_` 접두)

| 키 | 용도 | 기본값 |
|---|---|---|
| `tmPairs` | TM 쌍 배열 | `[]` |
| `tmEnabled` | TM 자동 주입 ON/OFF | `'1'` |
| `tmTopK` | 주입할 예시 개수 | `'4'` |
| `tmSilverAuto` | Copy 시 silver 자동 저장 | `'0'` (OFF) |
| `fallbackEnabled` | Echo 시 자동 폴백 ON/OFF | `'1'` |
| `fallbackProvider` | 폴백 provider | `'openrouter'` |
| `fallbackModel` | 폴백 model | `'google/gemini-3-flash-preview'` |
| `editRefineProvider` | Edit 재번역 provider | `''` (현재 모델) |
| `editRefineModel` | Edit 재번역 model | `''` |
| `editRefinePrompt` | Edit 재번역 커스텀 프롬프트 | `''` (default 사용) |
| `glossarySys` | 메인 용어집 (햄버거 → 용어집) | v77t에서 84쌍 자동 시드 |
| `glossaryUser` | 보조 용어집 (UI 없음) | `'[]'` |
| `useGlossarySys` | sys 용어집 사용 | `'1'` |
| `useGlossaryUser` | user 용어집 사용 | `'1'` |
| `use4Agent`/`use2Agent`/`usePlanMode` | 옛 모드 (v20.0에서 모두 강제 `'0'`) | `'0'` |

---

## 5. 최근 변경 이력 (v19.74t ~ v20.15t)

### v20 시리즈 — 재설계 + 안정화

| 버전 | 내용 |
|---|---|
| v20.0t | Agent 모드 전부 제거, TM 인프라 도입 (수집·주입·관리 UI) |
| v20.1t | Edit 팝업 결과 영역 추가 (TTS·병음·Copy=gold) + TM 관리 UI 완성 |
| v20.2t | "이 문장만 재번역"→"수정 재번역 및 학습", 현재 번역에 병음 |
| v20.3t | 원문 박스 추가, 글자 키움 (16px·200px) |
| v20.4t | callRefine이 Qwen MT 경우 qwen3.7-plus로 자동 교체 (MT는 system 무시) |
| v20.5t | renderChat 클로저 버그 — `lastUserText` 캡처 시점 문제 → 스냅샷 const로 수정 |
| v20.6t | Refine 호출 중엔 학습/용어집/TM 주입 차단(`_refineCallActive`), DIRECTION LOCK |
| v20.7t | Qwen 강제 번역 오버라이드도 refine 중엔 비활성 |
| v20.8t | Edit refine = 현재 메인 모델 사용 (2차 모델 LS 무시) |
| v20.9t | Edit refine 모델 선택 UI + 커스텀 프롬프트 UI |
| v20.10t | TM 4필드 저장 (origTrans 추가) — negative example로 모델 학습 강화 |
| v20.11t | Refine 프롬프트 대폭 강화 (5규칙) + refine 중에도 용어집 양방향 주입 |
| v20.12t | Qwen 일반 경로 용어집 sys+user 통합, system+user 양쪽 주입, 디버그 로그 |
| v20.13t | Copy 시 silver 자동 저장 기본 OFF (TM 토글로 ON 가능) |
| v20.14t | **Echo 감지 + 자동 폴백** + Edit 지침 user 메시지 최상단 배치(primacy) + temp=0 |
| v20.15t | **한국어 동음이의 경고** (아내가 등) + **동음이의 재해석 버튼** |

### v19 시리즈 (참고만)
- v19.74t~v19.80t: 모드 추가/조정 (이후 v20.0t에서 제거)
- v19.84t~v19.88t: Anthropic prompt caching (Haiku 최소 2048토큰 인지)
- v19.89t~v19.91t: 출력 토큰 캡, gap 조정, 로그 추가

전체 커밋 로그: `git log --oneline -100`

---

## 6. 진행 중이었던 미완 항목

### 6.1 디바이스 간 동기화 (사용자 Vultr 서버)

**중단 시점**: 셋업 명령 받기 직전 사용자가 "정지" → 새 방향(FastAPI + Cloudflare Tunnel) 언급 후 다시 멈춤.

**서버 정보**:
- Vultr Seoul, IP `158.247.232.44`, Ubuntu 24.04.4 LTS
- 1 vCPU / 2GB RAM / 55GB SSD
- 잔액 $21.14, 이번 달 사용 $3.77
- Python 3.12 설치됨, Node 없음, Caddy 없음, Docker 없음
- 22(SSH), 53(systemd-resolve) 외 포트 미사용
- ⚠ **root 비밀번호가 한 번 평문으로 노출됨** → 즉시 변경 권고했음 (사용자 확인 미상)

**미완 옵션**:
- A. DuckDNS + Caddy + Python(stdlib) — 처음 제안한 방향, 셋업 명령까지 작성했으나 사용자가 정지
- B. Cloudflare Tunnel + FastAPI — 사용자가 언급한 후 정지 (기존 feishu-bot 환경과 일관성 유지 의도)

**필요한 결정**:
1. 동기화 방식 (서버 자체 호스팅 vs Gist vs 수동 export/import)
2. HTTPS 방식 (도메인 X → Cloudflare Tunnel 권장)
3. 어디까지 동기화 (API 키 포함 여부)

**미리 결정된 사양**:
- 단일 JSON blob 동기화 (`GET/PUT /sync`)
- Bearer 토큰 인증
- last-write-wins (단순)
- 변경 시 5초 debounce push, 로드 시 1회 pull

**클라이언트 측 UI는 아직 만들지 않음** — 서버 셋업 끝나면 이 앱에 메뉴 → "클라우드 동기화" 항목 추가 예정.

### 6.2 4가지 기능 중 부분 적용
- 1. 번역쌍 수집 → ★★★☆ (Edit gold + Copy silver, **업로드 대화기록 자동 추출은 미구현** — 사용자가 샘플 미제공)
- 2. 유사 예시 검색·주입 → ★★★★★ 완전
- 3. 프롬프트 다이어트 → ★★☆☆☆ (인프라만, 사용자가 직접 시스템 프롬프트 줄여야)
- 4. 파인튜닝 → ★★☆☆☆ (JSONL export만, 실제 학습은 외부 DashScope 콘솔)

### 6.3 Edit 팝업 잔여 이슈
- 모델이 모호한 지침 + "기존 번역 그대로 출력 OK" 도주 경로 사용 → v20.14t에서 "반드시 수정" 규칙 추가, 도주 닫음
- 그래도 사용자 지침이 진짜 모호하면(예: "아내가" 사례) 모델이 일부만 고침 — 사용자 측 명확한 지침 필요. UI에 동음이의 경고는 v20.15t에서 추가됨
- 결과가 입력과 100% 동일할 때 자동 경고 표시는 아직 안 만듦 (옵션 A/B/C 제안만 함)

### 6.4 Anthropic Haiku 4.5 — 출력 속도 한계
- 한국에서 Anthropic 직접 Haiku 4.5 = 출력 ~50-80 tok/s
- 100 토큰 출력 = 2초 가까이 (= 사용자가 "느리다" 호소했던 원인)
- 해결책: max_tokens 캡 또는 모델 교체 (Gemini Flash가 더 빠름)
- v19.89t~v19.91t에서 캡 조정 시도, v20.0t 재설계로 파이프라인 자체 제거

---

## 7. 자주 발생하는 함정

### 7.1 Bk-Trans-Test 동기화 잊음
`index.html`만 수정하고 `Bk-Trans-Test/index.html`에 복사 안 하면 **배포 안 됨**. GitHub Pages가 `/Bk-Trans-Test/` 경로의 파일만 서빙.

### 7.2 APP_VERSION 안 올림
사용자가 새로고침해도 변경 적용 안 된 것처럼 보임. 매 commit마다 bump 권장.

### 7.3 Edit 으로 변경하는 큰 블록의 정확한 일치
`index.html`은 매우 큰 파일. Edit 도구의 `old_string`이 정확히 일치해야 함. 작은 인용 부호·전각/반각 차이로 실패하면 해당 라인 다시 Read 후 정확히 복사.

### 7.4 Qwen MT는 시스템 프롬프트 무시
`isQwenMtModel()`로 감지. 일반 흐름에서 system 프롬프트로 가이드 못 줌. `translation_options.terms` 만 의미 있음. Refine에선 `qwen3.7-plus`로 자동 교체 (v20.4t).

### 7.5 Anthropic 캐싱 임계값
- Sonnet/Opus: 1024 토큰 (≈3000 chars)
- Haiku 4.5: **2048 토큰** (≈6000 chars)
- 그 미만이면 `cache_control` 보내도 무시되고 처리 오버헤드만 발생 (v19.88t에서 모델별 임계 분리)

### 7.6 `lastUserText` 클로저 함정 (v20.5t에서 수정)
`renderChat` 루프에서 outer `let lastUserText` 변수를 click handler가 캡처하면 클릭 시점에 마지막 user 메시지 값으로 덮어짐. 메시지별 `const srcForThisMsg = lastUserText` 스냅샷 필수.

### 7.7 `_refineCallActive` 플래그
Refine 호출 중엔 `buildContextMessages`가 학습 프롬프트/TM 예시를 주입하지 않음. 새 호출 추가 시 flag set/reset 잊으면 refine이 일반 번역처럼 동작.

---

## 8. 사용자 페르소나·취향 (소통 노트)

- 한국어 사용. 짧고 직설적 메시지 선호.
- 추측·장황한 설명 싫어함 ("아니지 !!!" "정지" 등 강한 반응).
- 코드 변경 후 즉시 commit + push 기대. syntax error 절대 용납 X.
- 가장 답답해한 부분:
  - 같은 버그를 여러 번 다른 원인으로 잘못 진단할 때
  - "Korea 네트워크 핑계" 같은 검증 안 된 가설
- 가장 잘 통한 방식:
  - F12 콘솔 로그 보고 정확한 진단
  - 즉시 한 줄로 결론 + 옵션 제시 후 사용자 선택 받기

---

## 9. 즉시 다음에 할 만한 일 (선택)

| 우선순위 | 작업 |
|---|---|
| ★ | 사용자가 미해결 동기화 방향 결정 (Vultr 서버 셋업 vs 다른 방안) |
| ★ | Edit 결과가 입력과 동일할 때 경고 토스트 + 변경 부분 diff 하이라이트 (v20.15t 마지막에 사용자가 옵션 A/B/C 중 미선택) |
| | 업로드 대화기록에서 TM 쌍 자동 추출 (샘플 받아야 함) |
| | 메인 시스템 프롬프트 다이어트 (사용자 직접 또는 자동 도우미) |
| | TM 정렬 옵션 (hits 많은 순, 최근 순 등) |

---

## 10. 파일 위치 요약

| 파일 | 용도 |
|---|---|
| `index.html` | 작업본 (편집 대상) |
| `Bk-Trans-Test/index.html` | 배포본 (작업본과 항상 동일하게 유지) |
| `.github/workflows/auto-merge-claude.yml` | claude/** → main 자동 머지 |
| `handover/HANDOFF.md` | **이 문서** |
| `README.md` | (있다면 — 사용자가 만들었는지 확인 필요) |

---

## 11. 긴급 롤백 명령

문제 생기면:
```bash
# 직전 commit으로 되돌리기 (push 전)
git reset --hard HEAD~1

# push 된 상태에서 되돌리기 (revert 권장)
git revert HEAD
git push origin claude/jolly-archimedes-bgU4L
```

특정 버전으로 되돌리기:
```bash
git log --oneline | grep "v20.10t"  # 원하는 버전 sha 찾기
git checkout <sha> -- index.html Bk-Trans-Test/index.html
git commit -m "rollback to v20.10t"
git push
```

---

## 12. 환경 메모

- Node.js: index.html syntax check에만 사용 (별도 빌드 없음)
- 의존성: 0 (모두 인라인)
- 외부 라이브러리: `pinyinPro` CDN (병음 변환용)
- 폰트·CSS: 인라인
- 빌드 명령: 없음 (정적 파일 그대로)

---

**문서 끝.** 질문 있으면 사용자에게 직접 물어보고, 추측 금지. 큰 변경 전엔 사용자 확인 필수.
