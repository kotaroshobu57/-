"""Run against an isolated local-mode server on port 3000; no browser dependency."""
import json, re, urllib.request, urllib.parse, uuid
from pathlib import Path
from html.parser import HTMLParser
base='http://127.0.0.1:3000'
class Forms(HTMLParser):
 def __init__(self): super().__init__(); self.forms=[]; self.current=None
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs)
  if tag=='form': self.current={}; self.forms.append(self.current)
  if tag=='input' and self.current is not None and attrs.get('type')=='hidden': self.current[attrs.get('name','')]=attrs.get('value','')
 def handle_endtag(self,tag):
  if tag=='form': self.current=None

def get(path):
 with urllib.request.urlopen(base+path) as response: return re.sub(r'<!--.*?-->', '', response.read().decode()), response.url

def post(path,form,values):
 fields={**form,**values}
 boundary='----Smoke'+uuid.uuid4().hex
 body=''.join(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n' for key,value in fields.items())+f'--{boundary}--\r\n'
 request=urllib.request.Request(base+path,data=body.encode(),headers={'Content-Type':'multipart/form-data; boundary='+boundary,'Origin':base})
 with urllib.request.urlopen(request) as response: return re.sub(r'<!--.*?-->', '', response.read().decode()), response.url

def forms(html):
 p=Forms();p.feed(html);return p.forms

def db(): return json.loads(Path('.data/development.json').read_text())
name='検証専用会社'+uuid.uuid4().hex[:8]
company_id=None
try:
 home,_=get('/');assert 'ローカル開発モード' in home, 'Supabaseモードで実行禁止'
 assert '70点以上：4社' in home
 assert 'テスト名古屋オート' not in home and 'テスト大阪モーター' not in home
 companies,_=get('/companies');assert '10社' in companies
 filtered,_=get('/companies?'+urllib.parse.urlencode({'q':'（株）テスト仙台自動車','prefecture':'宮城県'}));assert '1社' in filtered and 'テスト東京整備' not in filtered
 filtered,_=get('/companies?'+urllib.parse.urlencode({'q':'０３－００００－０００２'}));assert '1社' in filtered
 html,url=post('/companies',forms(companies)[1],{'company_name':name,'prefecture':'東京都','phone':'＋８１ ３－１２３４－５６７８','mobile_phone':'０９０－１２３４－５６７８'})
 assert '/companies/' in url, (url, re.sub('<[^>]+>', '', html)[:1400])
 company_id=url.split('/companies/')[1].split('?')[0]
 assert '営業スコア：20点' in html
 c=next(c for c in db()['companies'] if c['id']==company_id);assert c['phone']=='＋８１ ３－１２３４－５６７８' and c['normalized_phone']=='0312345678'
 # two signals bring 20 -> 60 -> 90
 for signal_type,score in [('new_store',60),('job_new',90)]:
  html,_=post('/companies/'+company_id,forms(html)[-1],{'signal_type':signal_type,'title':'保存検証 '+signal_type,'description':'スモークテスト','detected_at':'2026-10-06'})
  assert f'営業スコア：{score}点' in html
 home,_=get('/');assert name in home
 # archive removes 40 points; restore returns to 90
 html,_=post('/companies/'+company_id,forms(html)[1],{})
 assert '営業スコア：50点' in html
 html,_=post('/companies/'+company_id,forms(html)[1],{})
 assert '営業スコア：90点' in html
 html,_=post('/companies/'+company_id,forms(html)[0],{'call_status':'NG','last_call_date':'2020-01-01','call_memo':'検証メモ','is_do_not_call':'on'})
 assert '表示対象外：営業禁止' in html and '検証メモ' in html
 home,_=get('/');assert name not in home
 html,_=post('/companies/'+company_id,forms(html)[0],{'call_status':'成約済み','last_call_date':'2020-01-01'})
 assert '表示対象外：成約済み' in html
 home,_=get('/');assert name not in home
 companies,_=get('/companies')
 html,url=post('/companies',forms(companies)[1],{'company_name':name,'phone':''})
 assert '重複候補' in html and len([c for c in db()['companies'] if c['company_name']==name])==1
 try: get('/companies/does-not-exist');raise AssertionError('Expected 404')
 except urllib.error.HTTPError as e: assert e.code==404
 print('PASS: 3画面、検索、会社・シグナル永続保存、スコア再計算、アーカイブ、NG更新、営業禁止・成約除外、重複防止、404')
finally:
 if company_id:
  data=db();data['companies']=[c for c in data['companies'] if c['id']!=company_id];data['signals']=[s for s in data['signals'] if s['company_id']!=company_id]
  file=Path('.data/development.json');temp=file.with_suffix('.cleanup.tmp');temp.write_text(json.dumps(data,ensure_ascii=False,indent=2));temp.replace(file)
