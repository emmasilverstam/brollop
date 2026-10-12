# brolopp
Bröllopsrepo för Gustav och Karin

Bildgalleriet använder Supabase-projektet `kvmlbxgizxypvloilbds` och den publika Storage-bucketen `kvallens-bilder`.

För att aktivera uppladdning och privata borttagningslänkar:

1. Aktivera **Allow anonymous sign-ins** under Authentication i Supabase. Gäster får en anonym session utan ett inloggningsformulär.
2. Kör `supabase/photo-gallery-setup.sql` i projektets SQL Editor. Det skapar den skyddade tabellen för hashade borttagningstoken och tar bort den gamla policyn för direkt uppladdning.
3. Kontrollera att bucketen är publik och har en SELECT-policy för galleriets listning. Gäster ska inte ha INSERT-, UPDATE- eller DELETE-policyer på denna bucket; uppladdning och borttagning går via funktionen.
4. Med Supabase CLI installerad och inloggad, kör `supabase functions deploy manage-photos --project-ref kvmlbxgizxypvloilbds` från repots rot. Behåll `verify_jwt = true` i `supabase/config.toml`.
5. Publicera `index.html` och `Brolopp.style.css` först när backend är klar.

Funktionen tillåter webbplatsens origin `https://emmasilverstam.github.io`. Den använder Supabases servernyckel från funktionens miljö; lägg aldrig en sådan nyckel i HTML eller Git.

Kontrollera på den publicerade sidan att en bild kan laddas upp, visas och laddas ner. Kopiera dess privata borttagningslänk, öppna den i en annan webbläsare och bekräfta borttagningen. Bilden ska försvinna ur galleriet och länken ska därefter inte kunna användas igen. Kontrollera också att en annan gästs bilder inte har en borttagningsknapp och att en ändrad token nekas.

Högst åtta bilder, 10 MB per bild och sammanlagt 50 MB kan laddas upp åt gången. Borttagningslänkarna sparas i webbläsaren; den som har en privat länk kan ta bort motsvarande bild. Äldre bilder saknar borttagningstoken och hanteras i Supabase. HEIC/HEIF kan laddas upp och laddas ner, men förhandsvisning beror på webbläsaren.

Supabase-dokumentation: [anonyma sessioner](https://supabase.com/docs/guides/auth/auth-anonymous) och [autentisering för Edge Functions](https://supabase.com/docs/guides/functions/auth).
