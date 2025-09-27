import banner from "../assets/banner.png";
import settings from "../assets/settings.png";
import avatar from "../assets/avatar.png";
import SidebarOption from "./SidebarOption";

interface InputProps {
  isOpen: boolean;
  onClose: () => void;
}

function Sidebar({ isOpen, onClose }: Readonly<InputProps>) {
  return (
    <div>
      {/* Listener for outside of sidebar clicks, could be changed to a button instead of a div for semantic reasons */}
      {isOpen && <div className="fixed inset-0 z-50 hidden sm:block" onClick={onClose}></div>}

      <div
        className={`fixed top-0 left-0 h-full lg:w-2/9 md:w-2/5 sm:w-3/5 w-full flex flex-col justify-between bg-sidebar z-100 transform transition-all duration-300 overflow-y-auto overscroll-contain ${
          isOpen ? "translate-x-0 opacity-100" : "-translate-x-full opacity-0 pointer-events-none"
        }`}
      >
        {/* When clicking the image the sidebar collapses, we'll see if we'll keep it that */}
        <img className="my-10 cursor-pointer" onClick={onClose} src={banner} alt="banner" />
        <ul className="p-0">
          {/* TODO: when clicking a option it should hide the side bar, implement this later */}
          <SidebarOption option="Dashboard" />
          <SidebarOption option="Sensor Information" />
          <SidebarOption option="Accumulator" />
          <SidebarOption option="add item 1" />
          <SidebarOption option="add item 2" />
          <SidebarOption option="add item 3" />
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
