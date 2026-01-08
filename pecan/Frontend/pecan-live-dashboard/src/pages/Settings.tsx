import { useOutletContext } from "react-router";

async function uploadFileToCache(file: File) {
  if (!file) return;

  if (!("caches" in window)) return;

  const cache = await caches.open("dbc-files");

  await cache.delete("/dbc-files/cache.dbc");
  const request = new Request(`/dbc-files/cache.dbc`);
  const res = new Response(await file.text(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
  await cache.put(request, res);
}

function Settings() {
  const banners = useOutletContext<BannerApi>();

  type BannerApi = {
    showESP: () => void;
    showCache: () => void;
    hideESP: () => void;
    hideCache: () => void;
    toggleESP: () => void;
    toggleCache: () => void;
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFileToCache(file);
    banners.showCache();
    banners.hideESP();
    globalThis.location.reload();
  };

  return (
    <div className="flex flex-col w-full h-full p-4 items-center">
      <h1 className="mt-4 text-white">Settings</h1>

      {/* File input */}
      <div className="w-full h-full">
        <div className="flex flex-row w-[95%] h-[8vh] rounded-md text-white font-semibold bg-option justify-between items-center px-4">
          <h3>Upload custom dbc file:</h3>
          <div>
            <label htmlFor="dbc-upload">Upload DBC</label>
            <input
              className="sr-only"
              id="dbc-upload"
              type="file"
              accept=".dbc"
              onChange={handleChange}
            ></input>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Settings;
