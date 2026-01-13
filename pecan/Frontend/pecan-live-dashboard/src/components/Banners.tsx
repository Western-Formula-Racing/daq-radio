import { forceCache } from "../utils/canProcessor";

export { DefaultBanner, CacheBanner };

interface InputProps {
  open: boolean;
  onClose: () => void;
}

const handleRevert = async () => {
  const cache = await caches.open("dbc-files");
  await cache.delete("dbc-files/cache.dbc");
  forceCache(false);
  globalThis.location.reload();
};

function DefaultBanner({ open, onClose }: Readonly<InputProps>) {
  if (!open) return null;
  return (
    <div className="flex flex-row w-full z-200 bg-dropdown-menu-bg justify-between items-center box-border px-4 py-1">
      <div className="w-[20%]"></div>
      <div className="w-[60%] flex justify-center">
        <span className="text-white text-[16pt] font-semibold">
          Using preconfigured DBC file. You can upload a custom DBC from
          Settings.
        </span>
      </div>
      <div className="flex flex-row w-[20%] h-[5vh] items-center justify-around items-stretch">
        <button
          onClick={() => (globalThis.location.href = "/settings")}
          className="bg-banner-button w-[120px] h-auto whitespace-normal break-words text-center text-[18pt] leading-tight font-semibold text-white rounded"
        >
          Open Settings
        </button>
        <button
          onClick={onClose}
          className="bg-banner-button w-[120px] text-center text-white font-semibold rounded"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function CacheBanner({ open, onClose }: Readonly<InputProps>) {
  if (!open) return null;
  return (
    <div className="flex flex-row w-full bg-dropdown-menu-bg justify-between items-center box-border px-4 py-1">
      <div className="w-[20%]"></div>
      <div className="w-[60%] flex justify-center">
        <span className="text-white text-[18pt] font-semibold">
          Using cached DBC file. This file was uploaded from your browser.
        </span>
      </div>
      <div className="flex flex-row w-[20%] items-center justify-around items-stretch">
        <button
          onClick={handleRevert}
          className="bg-banner-button w-[120px] h-auto whitespace-normal break-words text-center text-[18pt] leading-tight font-semibold text-white rounded"
        >
          Revert to<br></br> Preconfigured
        </button>
        <button
          onClick={onClose}
          className="bg-banner-button w-[120px] text-center text-white font-semibold rounded"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
