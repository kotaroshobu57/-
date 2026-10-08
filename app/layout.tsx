import Link from 'next/link';
import './globals.css';
import { dataMode } from '@/lib/store';
export const metadata={title:'自動車営業シグナル検知 v0.1',description:'会社の変化から営業タイミングを確認'};
export const dynamic='force-dynamic';
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="ja"><body><header className="border-b bg-white px-6 py-4"><p className="font-bold">自動車営業シグナル検知 v0.1</p><nav className="flex gap-6 mt-3"><Link href="/">今日の狙い目</Link><Link href="/companies">会社一覧</Link><Link href="/imports">マスター取込</Link></nav><p className="text-xs text-slate-500 mt-3">{dataMode()==='local'?'ローカル開発モード：架空データを .data に保存':'Supabase モード'} ・社内アクセス制限下で利用</p></header><main className="max-w-6xl mx-auto p-6">{children}</main></body></html>;}
