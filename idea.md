# Band support

Functionality is intended to display bands above main spectrum as reference for user. Those bands should be aligned to frequency axis - meaning scale along with zoom.

Few things to note:
1. Each band consists of frequency range, name and color
2. It is likely that there should be either 2 or 4 band lines - this is to be decided by you according to general recommendation.
3. Band text should hide when zoomed out - hover should still be available via tooltip
4. It is likely that bands can overlap in this case those should move to different lines - some ideas are welcome how to handle cases when there's not enough lines to accomodate bands as it is not reasonable to add many lines for bands as it takes spectrum space