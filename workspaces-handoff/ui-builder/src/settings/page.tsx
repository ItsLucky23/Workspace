import { useCallback, useEffect, useState } from "react";
import notify from "src/_functions/notify";
import ThemeToggler from "src/_components/ThemeToggler";
import { backendUrl } from "config";
import { useUpdateLanguage } from "src/_components/TranslationProvider";
import Avatar from "src/_components/Avatar";
import { useTranslator } from "src/_functions/translator";
import { apiRequest, apiRequestReponse } from "src/_sockets/apiRequest";
import { useSession } from "src/_providers/SessionProvider";

const incrementAvatarVersion = (url: string) => {
  const match = url.match(/[?&]v=(\d+)/);
  return match ? parseInt(match[1]) + 1 : 1;
}

export const template = 'main';
export default function Home() {

  const { session } = useSession();
  const { updateTheme } = ThemeToggler();
  const setLanguage = useUpdateLanguage();
  const translate = useTranslator();

  const [loaded, setLoaded] = useState(false);
  const [newLanguage, setNewLanguage] = useState<'nl' | 'en' | 'de' | 'fr'>(session?.language as 'nl' | 'en' |'de' | 'fr' || '');
  const [newAvatar, setNewAvatar] = useState<string>(session?.avatar || '');
  const [newName, setNewName] = useState<string>(session?.name || '');
  const [newTheme, setNewTheme] = useState<'light' | 'dark'>(session?.theme || 'dark');

  if (!session) return null;

  let url;

  if (newAvatar.includes('base64')) {
    url = new URL(newAvatar, window.location.origin);
    url.search = ""; // remove query params
  }

  const displayUrl = newAvatar.includes('base64') 
    ? url?.toString() 
    : newAvatar.startsWith("http")
    ? newAvatar
    : `${backendUrl}/uploads/${session.avatar}`
  console.log(displayUrl)

  const normalizeAvatar = (url: string) => url.split('?')[0];

  const saveUser = useCallback(async () => {
    if (!loaded) {
      return setLoaded(true);
    }

    if (
      newLanguage == session.language
      && normalizeAvatar(newAvatar) === normalizeAvatar(session.avatar)
      && newName == session.name
      && newTheme == session.theme
    ) {
      notify.info({ key: 'settings.noChangesMade' })
      return;
    }
    const response = await apiRequest({
      name: 'updateUser',
      data: {
        language: newLanguage != session.language? newLanguage : undefined,
        avatar: newAvatar != session.avatar? newAvatar : undefined,
        name: newName != session.name? newName : undefined,
        theme: newTheme != session.theme? newTheme : undefined,
      },
    }) as apiRequestReponse
    if (response.status === 'success') {
      notify.success({ key: 'settings.updatedUser' })
    } else {
      notify.error({ key: 'settings.failedUpdateUser' })
    }
  }, [newLanguage, newAvatar, newName, newTheme, session]);


  //? we trigger saveUser when the newAvatar changes so that the avatar is saved immidiatly, we dont call the saveUser in the onchange callback cause than it causes a race codition between the function calling and newAvatar having the new value
  useEffect(() => {
    if (!newAvatar) return;
    
    saveUser();
  }, [newAvatar])

  return (
    <div className='flex items-center justify-center w-full h-full bg-background'>
      <div className="bg-container border-2 border-container-border flex flex-col p-8 gap-4 rounded-2xl max-w-[360px] w-[90%]">

        <div className="flex gap-4 items-center">
          { newAvatar || session.avatar ? (
            <img src={displayUrl} 
              className="rounded-xl min-w-28 max-w-28 object-cover aspect-square select-none"></img>
          ) : (
            <div className="rounded-xl min-w-28 max-w-28 object-cover aspect-square select-none">
              <Avatar
                user={{
                  name: session.name,
                  avatarFallback: session.avatarFallback
                }}
                textSize="text-4xl"
              />
            </div>
          )}
          <div className="space-y-2">
            <input type="file" className="hidden"></input>
            <button
              className="w-full py-1 bg-container2 border-container2-border border-2 rounded-md text-title font-semibold text-lg"
              onClick={() => {
                const input = document.querySelector('input[type="file"]') as HTMLInputElement;
                input.click();
                input.onchange = async () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  const maxSize = 4 * 1024 * 1024; // 4 MB
                  if (file.size > maxSize) {
                    notify.error({ key:'settings.sizeToLarge' })
                    return;
                  }

                  notify.info({ key: 'settings.loadingImg' })
                  const reader = new FileReader();
                  reader.onload = async () => {
                    setNewAvatar(prevUrl => `${reader.result}?v=${incrementAvatarVersion(prevUrl||"")}`)
                    notify.success({ key: 'settings.imgLoaded' })
                  };
                  reader.readAsDataURL(file);
                }
              }}
            >
              {/* Change avatar */}
              {translate({ key: 'settings.changeAvatar' })}
            </button>
            {/* <button 
              className="w-full py-1 bg-wrong/50 border-wrong border-2 rounded-md text-title font-semibold text-lg"
              onClick={() => {
                ref.open(
                  <ConfirmMenu
                    title={(translate({ key: 'settings.changeAvatar' }))}
                    content={'asd'}
                    resolve={(success) => {
                      console.log(success)
                    }}
                  />
                )
              }}
            >
              {translate({ key: 'settings.deleteAvatar' })}
            </button> */}
            <div className="text-muted text-sm">
              {/* JPG, GIV or PNG. 1MB max. */}
              {translate({ key:'settings.changeAvatarDescription' })}
            </div>
          </div>
        </div>

        <div className="space-y-2 w-full">
          <div className="text-lg font-semibold">Name</div>
          <input 
            className={`w-full bg-container2 border-container2-border border-2 focus:outline-0 focus:border-container3-border transition-all duration-150 p-2 rounded-md`}
            value={newName}
            onChange={(e) => { setNewName(e.target.value) }}
          ></input>
        </div>

        <div className="w-full flex flex-col gap-2">
          <div className="text-lg font-semibold">
            {/* Language */}
            {translate({ key:'settings.language.title' })}
          </div>
          <div className="flex w-full gap-2">
            <button
              onClick={() => { 
                setNewLanguage('nl');
                setLanguage('nl');
               }}
              className={`w-full border-2 p-2 rounded-md
                ${newLanguage == 'nl' ? 'bg-container3 border-container3-border' : 'bg-container2 border-container2-border'}
                hover:bg-container3 hover:border-container3-border transition-all duration-300
              `}
            >
              {/* NL */}
              {translate({ key:'settings.language.nl' })}
            </button>
            <button
              onClick={() => { 
                setNewLanguage('en'); 
                setLanguage('en');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newLanguage == 'en' ? 'bg-container3 border-container3-border' : 'bg-container2 border-container2-border'}
                hover:bg-container3 hover:border-container3-border transition-all duration-300
              `}
            >
              {/* EN */}
              {translate({ key:'settings.language.en' })}
            </button>
            <button
              onClick={() => { 
                setNewLanguage('de'); 
                setLanguage('de');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newLanguage == 'de' ? 'bg-container3 border-container3-border' : 'bg-container2 border-container2-border'}
                hover:bg-container3 hover:border-container3-border transition-all duration-300
              `}
            >
              {/* DE */}
              {translate({ key:'settings.language.de' })}
            </button>
            <button
              onClick={() => { 
                setNewLanguage('fr'); 
                setLanguage('fr');
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newLanguage == 'fr' ? 'bg-container3 border-container3-border' : 'bg-container2 border-container2-border'}
                hover:bg-container3 hover:border-container3-border transition-all duration-300
              `}
            >
              {/* FR */}
              {translate({ key:'settings.language.fr' })}
            </button>
          </div>
        </div>

        <div className="w-full flex flex-col gap-2">
          <div className="text-lg font-semibold">
            {/* Theme */}
            {translate({ key:'settings.theme.title' })}
          </div>
          <div className="flex w-full gap-2">
            <button
              onClick={() => { 
                setNewTheme('light');
                updateTheme('light'); 
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newTheme == 'light' ? 'bg-container3 border-container3-border' : 'bg-container2 border-container2-border'}
                hover:bg-container3 hover:border-container3-border transition-all duration-300
              `}
            >
              {/* Light mode */}
              {translate({ key:'settings.theme.light' })}
            </button>
            <button
              onClick={() => { 
                setNewTheme('dark');
                updateTheme('dark'); 
              }}
              className={`w-full border-2 p-2 rounded-md
                ${newTheme == 'dark' ? 'bg-container3 border-container3-border' : 'bg-container2 border-container2-border'}
                hover:bg-container3 hover:border-container3-border transition-all duration-300
              `}
            >
              {/* Dark mode */}
              {translate({ key:'settings.theme.dark' })}
            </button>
          </div>
        </div>

        <button 
          className="w-full bg-primary text-white py-2 rounded-lg"
          onClick={saveUser}
        >
          {/* Save data */}
          {translate({ key:'settings.saveChanges' })}
        </button>

      </div>
    </div>
  )
}