.PHONY: test validate pack install uninstall doctor prefs enable disable
UUID := window-atlas@tanabe1478

test:
	node --test tests/*.test.js

validate:
	python3 tools/manage.py validate

pack: validate
	python3 tools/manage.py pack

install: validate
	python3 tools/manage.py install

uninstall:
	python3 tools/manage.py uninstall

doctor:
	python3 tools/manage.py doctor

prefs:
	gnome-extensions prefs $(UUID)

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)
