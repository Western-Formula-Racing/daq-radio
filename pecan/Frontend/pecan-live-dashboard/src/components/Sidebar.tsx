import banner from "../assets/banner.png";
import settings from "../assets/settings.png";
import avatar from "../assets/avatar.png";
import SidebarOption from "./SidebarOption";

interface InputProps {
  open: boolean;
  onClose: () => void;
}

function Sidebar({ open, onClose }: Readonly<InputProps>) {
  return (
    <div>
      {/* Listener for outside of sidebar clicks, could be changed to a button instead of a div for semantic reasons */}
      {open && <div className="fixed inset-0 z-50" onClick={onClose}></div>}

      <div
        className={`fixed top-0 left-0 h-full w-2/9 flex flex-col justify-between bg-sidebar z-100 transform transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <img className="my-10" src={banner} alt="banner" />
        <ul className="p-0">
          <SidebarOption option="Dashboard" />
          <SidebarOption option="Sensor Information" />
          <SidebarOption option="Accumulator" />
          <SidebarOption option="add item 1" />
          <SidebarOption option="add item 2" />
          <SidebarOption option="add item 3" />
          <SidebarOption option="add item 4" />
        </ul>

        {/* The <a> tags will be changed to Link when adding React Router */}
        <footer className="font-footer flex flex-col space-y-8 mb-10">
          <div className="text-md flex flex-row space-x-6 ml-4">
            <img src={avatar} alt="avatar" width={30} height={30} />
            <a href="/" className="!no-underline !text-sidebarfg">
              Account
            </a>
          </div>
          <div className="flex flex-row space-x-6 text-md ml-4">
            <img src={settings} alt="settings" width={30} height={30} />
            <a href="/" className="!no-underline !text-sidebarfg">
              Settings and Preferences
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default Sidebar;
