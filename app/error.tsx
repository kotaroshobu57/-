"use client";
export default function ErrorPage({reset}:{reset:()=>void}) { return <section><h1>データの読み込みに失敗しました</h1><p className="mb-4">保存先の設定と接続を確認してください。Supabase モードでは接続失敗時にローカルデータへ切り替えません。</p><button onClick={reset}>再試行</button></section>; }
