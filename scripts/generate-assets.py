"""Original local SVG pictograms and PWA marks. No downloaded artwork."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'public' / 'assets'
(root / 'cards').mkdir(parents=True, exist_ok=True)

def person(hair, shirt, extra=''):
    return f'<path d="M35 97V81a29 29 0 0 1 58 0v16" fill="{shirt}"/><circle cx="64" cy="38" r="22" fill="#f0c7a3"/><path d="M42 36Q39 10 64 12q25 0 22 24Q74 27 65 22q-7 12-23 14" fill="{hair}"/><path d="M57 42h.1M72 42h.1M58 52q6 5 12 0"/>{extra}'

arts = {
 'want': '<path d="M44 83V50a6 6 0 0 1 12 0v14-35a6 6 0 0 1 12 0v34-30a6 6 0 0 1 12 0v33-19a6 6 0 0 1 12 0v34q-2 19-23 21H57q-8-1-13-10L30 72q-5-9 4-12l10 10" fill="#f0c7a3"/><path d="M20 32h13m-7-7v14M93 19h11m-5-5v10" stroke="#d69442"/>',
 'help': '<path d="m24 74 25-19 21 2 18-17q7-4 10 3L78 72 56 88 34 92" fill="#f0c7a3"/><path d="m18 78 13-9 17 23-15 11z" fill="#acc6d6"/><path d="M56 56v-9a10 10 0 0 1 20 0v8M66 24v-9m-18 14-6-6m42 5 7-6"/>',
 'more': '<circle cx="64" cy="56" r="39" fill="#d9e7ad"/><path d="M64 33v46M41 56h46" stroke-width="9"/>',
 'stop': '<path d="m46 17 36 0 26 25v29L83 96H46L21 71V42z" fill="#edaa94"/><path d="M48 40h32v32H48z" fill="#fff9ec" stroke="none"/>',
 'yes': '<circle cx="64" cy="56" r="39" fill="#d9e7ad"/><path d="m42 56 15 15 29-31" stroke-width="7"/>',
 'no': '<circle cx="64" cy="56" r="39" fill="#efcbbf"/><path d="m48 40 32 32m-32 0 32-32" stroke-width="7"/>',
 'pause': '<circle cx="64" cy="56" r="39" fill="#cbdce8"/><rect x="47" y="36" width="11" height="40" rx="4" fill="#5e7c87" stroke="none"/><rect x="71" y="36" width="11" height="40" rx="4" fill="#5e7c87" stroke="none"/>',
 'toilet': '<path d="M40 51h52v14q0 26-32 27V75Q40 71 40 51z" fill="#f9fbf5"/><rect x="74" y="17" width="23" height="36" rx="4" fill="#cbdce8"/><path d="M60 91v7h24V82M81 28h8"/>',
 'water': '<path d="m40 29 8 68h33l8-68z" fill="#ebf4f2"/><path d="m44 58 4 39h33l5-39q-10 6-22 0t-20 0" fill="#93c8dd"/><path d="M64 10q-15 17 0 20 15-3 0-20" fill="#93c8dd"/>',
 'apple': '<path d="M64 35q-28-23-39 9-10 33 18 50 13 7 21 0 10 7 24 0 27-20 15-50-10-29-39-9" fill="#e8967d"/><path d="M64 35q-3-20 9-24M69 23q17-18 28-6-10 19-28 6" fill="#9fb786"/><path d="M39 49q-7 12-2 24" stroke="#fff6e9" stroke-width="5"/>',
 'banana': '<path d="M31 22q14 56 67 42-4 26-32 32-37-1-39-44V30z" fill="#f0d17d"/><path d="M35 45q15 46 58 29M27 22l8-2M94 61l7 9"/>',
 'bread': '<path d="M32 44q-15-15-1-26 13-13 34-9 24-1 33 13 7 12-4 22v52H32z" fill="#d9ad78"/><path d="M44 45q-9-13 1-20 8-6 23-4 16-1 20 8 3 8-6 15v41H44z" fill="#f4dfb1" stroke="none"/><path d="M54 45h.1M71 66h.1M57 77h.1"/>',
 'soup': '<path d="M21 54h87q-3 37-43 38Q25 91 21 54z" fill="#e6be93"/><ellipse cx="64" cy="54" rx="43" ry="12" fill="#edc761"/><path d="M42 29q-8-9 0-18m22 18q-8-9 0-18m22 18q-8-9 0-18M47 94h35"/><circle cx="45" cy="53" r="3" fill="#7d9f65" stroke="none"/><circle cx="74" cy="57" r="3" fill="#de8e60" stroke="none"/>',
 'milk': '<path d="M42 32 53 13h26l10 19v66H42z" fill="#f9fbf5"/><path d="M42 32h47M53 13v19M42 59h47v27H42z" fill="#acc6d6"/><path d="M65 45q-13 14 0 18 13-4 0-18" fill="#cbdce8"/>',
 'cookie': '<circle cx="64" cy="56" r="40" fill="#dfbc83"/><path d="m49 29 4 7m30 4-5 4m-4 35-5-3m-26-8 6-3m19-12 5 3" stroke="#845d43" stroke-width="7"/><path d="M41 42h.1M86 65h.1M54 83h.1"/>',
 'juice': '<path d="M40 39h49l-6 59H46z" fill="#edc761"/><path d="m63 75 8-57 18-8" fill="none"/><circle cx="95" cy="52" r="17" fill="#eab55f"/><path d="M95 39v26M82 52h26" stroke="#fff4d6"/>',
 'play': '<rect x="25" y="48" width="37" height="41" rx="5" fill="#a9bfd2"/><path d="m66 54 19-33 20 33z" fill="#e5bc6a"/><circle cx="83" cy="79" r="21" fill="#e8ab96"/><path d="M38 62h12m-6-6v12"/>',
 'book': '<path d="M64 31Q42 15 20 26v61q22-10 44 5 23-15 45-5V26Q87 15 64 31z" fill="#c1d2b1"/><path d="M64 31v61M31 40q12-2 23 5M31 54q12-2 23 5M76 45q12-7 22-5M76 59q12-7 22-5"/>',
 'walk': '<circle cx="68" cy="21" r="10" fill="#f0c7a3"/><path d="m63 39-9 27 19 11 4 23M56 62 41 92M62 40l15 15 16 3M59 44 45 55 32 53" fill="none" stroke-width="8"/><path d="m36 98 17 0m17 4 14-1" stroke="#9db78a" stroke-width="5"/>',
 'sleep': '<path d="M35 33q-8 29 27 39 26 5 36-15-3 44-43 41-34-5-32-38 0-16 12-27" fill="#e5c67f"/><path d="M68 20h16L68 37h16M92 7h12l-12 13h12" stroke="#8a9bb4"/>',
 'draw': '<rect x="29" y="17" width="64" height="81" rx="4" fill="#fff9ec"/><path d="m44 77 3-15 40-40 12 12-40 40z" fill="#e6c070"/><path d="m47 62 12 12M87 22l12 12M39 88h41"/><path d="m47 62-3 15 15-3" fill="#7b8f80"/>',
 'music': '<path d="M50 79V30l48-13v49M50 42l48-13" fill="none" stroke-width="5"/><ellipse cx="38" cy="83" rx="15" ry="11" fill="#b1c3d7" transform="rotate(-20 38 83)"/><ellipse cx="86" cy="71" rx="15" ry="11" fill="#b1c3d7" transform="rotate(-20 86 71)"/>',
 'wash': '<path d="M43 23h36v14H65v14M72 23V12M64 12h17" fill="none" stroke-width="7"/><path d="M29 80q19-5 24-12l11-10q7-5 10 1l-7 11 21-6q15-1 9 8L72 91H40z" fill="#f0c7a3"/><path d="M63 43q-8 13 0 15 9-2 0-15" fill="#9ec8d8"/><circle cx="90" cy="36" r="7" fill="#e3edf0"/><circle cx="102" cy="50" r="4" fill="#e3edf0"/>',
 'eat': '<circle cx="71" cy="59" r="33" fill="#e9ebdf"/><circle cx="71" cy="59" r="22" fill="#f8faf1"/><path d="M22 17v27m-7-27v20q0 10 14 0V17M22 44v52M110 18v78M110 18q-15 17 0 34" stroke-width="4"/>',
 'mom': person('#755b48','#e6b6a6','<path d="M42 35q-9 9-8 30M86 34q9 14 7 31"/>'),
 'dad': person('#6c6456','#abc6d4','<path d="M54 47q10 14 20 0" stroke="#906f53"/>'),
 'me': person('#ab8659','#d5df9c'),
 'home': '<path d="m20 53 44-36 44 36M31 45v52h66V45" fill="#d4dfc3"/><path d="M54 97V65h23v32" fill="#ecd5ad"/><path d="M82 31V16h13v25" fill="#edb29a"/>',
 'park': '<path d="M34 96V55m56 41V45" stroke="#94734f" stroke-width="7"/><path d="M13 53q-4-18 15-23 3-20 23-9 23 15 6 33-19 15-44-1" fill="#a9c28c"/><path d="M66 47q-4-18 15-23 3-20 23-9 23 15 6 33-19 15-44-1" fill="#c0d2a1"/><path d="M15 99h98"/>',
 'school': '<path d="M27 43h74v54H27z" fill="#f0d49b"/><path d="m18 43 46-27 46 27z" fill="#b3c9d5"/><path d="M54 97V69h21v28M39 55h9v9h-9zM82 55h9v9h-9zM64 16V7h18l-4 6H64"/>',
 'happy': '<circle cx="64" cy="56" r="39" fill="#e5d494"/><path d="M46 45h.1M82 45h.1" stroke-width="7"/><path d="M44 62q20 28 40 0" fill="#fff9ec"/>',
 'sad': '<circle cx="64" cy="56" r="39" fill="#b9cddd"/><path d="M46 46h.1M82 46h.1" stroke-width="7"/><path d="M48 77q16-16 32 0M84 57q-10 14 0 16 9-2 0-16" fill="#92b8d0"/>',
 'hurt': '<path d="M64 91 27 54Q9 25 36 18q19-3 28 14 12-18 28-14 28 7 10 36z" fill="#e7b5a5"/><path d="m64 34-8 18 14 9-10 22" fill="none" stroke="#fff8e8" stroke-width="5"/>',
 'hot': '<circle cx="64" cy="56" r="23" fill="#edc366"/><path d="M64 15v10M64 87v10M23 56h10M95 56h10M35 27l7 7M86 78l7 7M35 85l7-7M86 34l7-7" stroke="#d39a47" stroke-width="4"/>',
 'cold': '<path d="M64 14v84M28 35l72 42M28 77l72-42M54 23l10 10 10-10M54 89l10-10 10 10M31 48l14-5-2-14M85 83l-2-14 14-5M31 64l14 5-2 14M85 29l-2 14 14 5" stroke="#86afc3" stroke-width="4"/>',
 'tired': '<circle cx="64" cy="56" r="39" fill="#dccbe1"/><path d="M40 45q7 7 14 0M74 45q7 7 14 0"/><ellipse cx="64" cy="73" rx="7" ry="10" fill="#a988a9"/>',
}
for name, content in arts.items():
    (root / 'cards' / f'{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 112"><g stroke="#38564a" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round">{content}</g></svg>')

brand = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect x="90" y="98" width="332" height="282" rx="64" fill="#356951"/><path d="m158 356-11 70 79-55" fill="#356951"/><rect x="154" y="140" width="204" height="204" rx="26" fill="#fffef8"/><circle cx="301" cy="190" r="20" fill="#eb795c"/><path d="m178 310 49-65 39 47 26-30 42 48z" fill="#93ae76"/><path d="m178 310 49-65 39 47 26-30 42 48" fill="none" stroke="#356951" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
(root / 'brand.svg').write_text(brand)
master = Image.new('RGB', (1024, 1024), '#f3f0e7')
draw = ImageDraw.Draw(master)
def box(coords): return tuple(v * 2 for v in coords)
draw.rounded_rectangle(box((90, 98, 422, 380)), radius=128, fill='#356951')
draw.polygon([(316,712),(294,852),(452,742)], fill='#356951')
draw.rounded_rectangle(box((154,140,358,344)), radius=52, fill='#fffef8')
draw.ellipse(box((281,170,321,210)), fill='#eb795c')
mountain=[(178,310),(227,245),(266,292),(292,262),(334,310)]
draw.polygon([(x*2,y*2) for x,y in mountain],fill='#93ae76')
draw.line([(x*2,y*2) for x,y in mountain],fill='#356951',width=16,joint='curve')
for size, name in [(192, 'icon-192.png'), (512, 'icon-512.png'), (512, 'icon-maskable.png')]:
    master.resize((size,size),Image.Resampling.LANCZOS).save(root / name)
print(f'Generated {len(arts)} original SVG pictograms, distinct brand and 3 PWA icons')
