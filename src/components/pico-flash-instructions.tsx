import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

interface PicoFlashInstructionsProps {
  version: string;
  isOpen: boolean;
  onClose: () => void;
}

const PicoFlashInstructions: React.FC<PicoFlashInstructionsProps> = ({
  version,
  isOpen,
  onClose,
}) => {
  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Flashing Raspberry Pi Pico</AlertDialogTitle>
          <AlertDialogDescription>
            To flash your Raspberry Pi Pico with MemCARDuino firmware, please
            follow these steps:
            <ol className="mt-2 list-inside list-decimal space-y-2">
              <li>Download the MemCARDuino UF2 file for Raspberry Pi Pico.</li>
              <li>
                Press and hold the BOOTSEL button on your Pico while connecting
                it to your computer via USB.
              </li>
              <li>
                Release the BOOTSEL button once connected. Your Pico should
                appear as a USB mass storage device.
              </li>
              <li>
                Drag and drop the downloaded UF2 file into the Pico storage
                device.
              </li>
              <li>
                The Pico will automatically reboot with the new firmware
                installed.
              </li>
            </ol>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction asChild>
            <Button onClick={onClose}>Close</Button>
          </AlertDialogAction>
          <Button variant="outline" asChild>
            <a href={`/memcarduino/MemCARDuino_v${version}_pico.uf2`} download>
              Download UF2 File
            </a>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default PicoFlashInstructions;
