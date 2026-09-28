#!/usr/bin/env node
/* 원장님몰래 — 콘텐츠 자동 생성 (Claude API)
 * topics.json에서 '대기' 주제를 꺼내 → Claude API(웹서치 포함)로 post.json 생성
 * → posts/YYYY-MM-DD/ 에 저장하고 topics.json 상태 갱신.
 * 필요 env: ANTHROPIC_API_KEY  (선택: MODEL, 기본 claude-sonnet-4-5)
 */
const fs = require('fs');
const path = require('path');

const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error('ANTHROPIC_API_KEY 필요'); process.exit(1); }
const MODEL = process.env.MODEL || 'claude-sonnet-4-5';
const root = __dirname;

const topics = JSON.parse(fs.readFileSync(path.join(root, 'topics.json'), 'utf8'));
const guide = fs.readFileSync(path.join(root, 'guide.md'), 'utf8');
const todo = topics.find(t => t.status === '대기');
if (!todo) { console.error('대기 주제가 없습니다 — topics.json을 채워주세요'); process.exit(2); }

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // KST 기준 날짜 (UTC 크론이 한국 새벽에 돌아도 오늘 폴더가 맞도록)
const outDir = path.join(root, 'posts', today);

const SCHEMA_EXAMPLE = {
  series: 'MONEY CUT', issueNo: '#002', brand: '원장님{c}몰래{/c}',
  cards: [
    { type: 'cover', headline: '한 줄씩 줄바꿈한\n후킹 헤드라인\n**형광 강조**', headlineSize: 92 },
    { type: 'content', title: '소제목', text: '본문. **마커 강조**와 <b>흰색 강조</b> 사용, \\n\\n 단락 구분' },
    { type: 'content', title: '체크리스트형 소제목', points: ['항목 1 **강조**', '항목 2', '항목 3', '항목 4'] },
    { type: 'cta', title: 'CTA 소제목', text: 'CTA 본문\n**강조**', sub: '프로필 링크 안내', disclaimer: '면책 문구' },
  ],
  caption: '캡션 본문 + 해시태그 15개 (#원장님몰래 포함)',
};

// 2026-09-28: 모델 응답 JSON 깨짐(#141)·API 일시 오류 대비 — 최대 3회 재시도 후 실패 처리
async function generateOnce() {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{
        role: 'user',
        content: `너는 미용인 대상 인스타 정보지 '원장님몰래'의 콘텐츠 에디터다.

## 운영 가이드 (가드레일 반드시 준수)
${guide}

## 오늘의 주제
- 시리즈: ${todo.series} ${todo.issueNo}
- 주제: ${todo.topic}
- 핵심 메시지/근거: ${todo.note}

## 작업
1. 필요하면 웹서치로 사실·통계·출처를 확인하라 (통계는 출처 필수, 확인 안 되는 수치는 쓰지 마라).
2. 카드뉴스 post.json을 작성하라. 표지 1장 + 본문 2~3장 + CTA 1장. 아래 스키마를 정확히 따르라:
${JSON.stringify(SCHEMA_EXAMPLE, null, 2)}

규칙: **텍스트**는 형광 마커 강조, <b>텍스트</b>는 흰색 굵게. 카드 본문에 특정 연·월 표기 금지(현재형 프레이밍). 법률·세무 주제면 CTA 카드에 disclaimer 필수. 캡션 끝에 출처 표기와 해시태그(#원장님몰래 포함 15개 내외).

응답은 post.json의 JSON만 출력하라. 코드블록 없이 순수 JSON.`,
      }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const jsonStr = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const post = JSON.parse(jsonStr);
  // 구조 검증: 표지 1 + 본문 ≥1 + CTA 1, 캡션 존재
  if (!Array.isArray(post.cards) || post.cards.length < 3) throw new Error(`cards 부족(${post.cards && post.cards.length})`);
  if (post.cards[0].type !== 'cover' || !post.cards[0].headline) throw new Error('표지(cover) 누락');
  if (!post.cards.some(c => c.type === 'cta')) throw new Error('CTA 카드 누락');
  if (!post.caption || post.caption.length < 50) throw new Error('caption 누락/짧음');
  return post;
}

async function main() {
  console.log(`주제: [${todo.series} ${todo.issueNo}] ${todo.topic}`);
  let post, lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { post = await generateOnce(); break; }
    catch (e) {
      lastErr = e;
      console.warn(`생성 시도 ${attempt}/3 실패: ${e.message.slice(0, 200)}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 20000 * attempt));
    }
  }
  if (!post) throw lastErr;
  post.series = todo.series; post.issueNo = todo.issueNo; post.brand = '원장님{c}몰래{/c}';

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'post.json'), JSON.stringify(post, null, 2));
  todo.status = `생성완료(${today})`;
  fs.writeFileSync(path.join(root, 'topics.json'), JSON.stringify(topics, null, 2));
  console.log(`post.json 저장: posts/${today}/`);
  fs.writeFileSync(path.join(root, '.last_post_dir'), `posts/${today}`);
}
main().catch(e => { console.error('생성 실패:', e.message); process.exit(1); });
