import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompanyName, normalizePhone, duplicateCompany } from '../lib/normalize';
import { createSeed } from '../lib/seed';
import { calculateScore, SCORE_RULES } from '../lib/scoring';
const now=new Date('2026-10-06T12:00:00Z');
const db=createSeed(now);
test('会社名の法人格・記号・全半角・大小文字を正規化し元を保持',()=>{
 for(const v of ['株式会社 ＡＢＣ・自動車','（株）abc自動車','㈱ ABC 自動車','有限会社ABC自動車','合同会社ABC自動車']) assert.equal(normalizeCompanyName(v),'abc自動車');
 assert.equal(db.companies[0].company_name,'株式会社テスト北海モータース');
});
test('電話番号の国番号・全角・空白・ハイフン',()=>{
 for(const p of ['＋８１ ９０－１２３４－５６７８','+81 (0)90-1234-5678','０９０ １２３４ ５６７８'])assert.equal(normalizePhone(p),'09012345678');
 assert.equal(normalizePhone('+81-3-1234-5678'),'0312345678');
});
test('名前または電話で重複候補、空の電話を一致扱いしない',()=>{
 assert.equal(duplicateCompany(db.companies,'（株）テスト北海モータース','')?.id,db.companies[0].id);
 assert.equal(duplicateCompany(db.companies,'別会社','０３ ００００ ０００１')?.id,db.companies[0].id);
 assert.equal(duplicateCompany(db.companies,'別会社',''),undefined);
});
test('10社のスコアと対象外条件',()=>{
 assert.equal(db.companies.length,10);
 assert.deepEqual(db.companies.map(c=>calculateScore(c,db.signals,now).score),[85,30,75,70,85,70,65,70,55,20]);
 assert.deepEqual(db.companies.map(c=>calculateScore(c,db.signals,now).isTarget),[true,false,true,true,false,false,false,true,false,false]);
 assert.equal(calculateScore(db.companies[4],db.signals,now).excludedReason,'営業禁止');
 assert.equal(calculateScore(db.companies[5],db.signals,now).excludedReason,'成約済み');
});
test('365日境界・携帯の二重加算なし・別会社とアーカイブを除外',()=>{
 const c={...db.companies[9],phone:'080-1234-5678',mobile_phone:'090-1234-5678',existing_master:true};
 assert.equal(calculateScore({...c,last_call_date:'2025-10-06'},[],now).score,15);
 assert.equal(calculateScore({...c,last_call_date:'2025-10-07'},[],now).score,5);
 assert.equal(calculateScore(c,db.signals,now).score,5);
 const signal={...db.signals[0],company_id:c.id,score:999};
 assert.equal(calculateScore(c,[signal],now).score,45);
 assert.equal(calculateScore(c,[{...signal,status:'archived'}],now).score,5);
});
test('全シグナル種別は設定の点数を使う',()=>{
 const c={...db.companies[0],existing_master:true};
 for(const [type,points] of Object.entries(SCORE_RULES.signal))assert.equal(calculateScore(c,[{...db.signals[0],signal_type:type as typeof db.signals[0]['signal_type']}],now).score,points);
});
