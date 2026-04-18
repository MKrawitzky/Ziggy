# TDF-SDK Changelog

This document lists changes between successive releases of the tdf-sdk.  Oldest versions are at the bottom of the file.

## Release TDF-SDK 3.3.6 2025-10-31
DLL v3.3.*
* Improved calibration performance
* Added "Enhanced Linear" and "Enhanced Quadratic" mobility calibration
* Added getMassAxisFromTransformatorString to calculate m/z values from XMass Transformator (MALDI)
* Greatly improved performance for MS/MS extraction

## In Development TDF-SDK 2.30.1
DLL v2.30.*
* Added pressure compensation to visualization api

## Internal Release TDF-SDK 2.27.0.0
DLL v2.27.*
* The implementation of the XIC-extraction function tims_extract_chromatograms has been optimized to execute faster when a large number of chromatograms are extracted.
* Improvements to generation of centroided spectra (as delivered to msms_spectrum_function callbacks):
    * reports improved area values (symmetric integration around peak location; avoidance of overlapping integration areas between closely neighboring peaks)
    * finds peaks correctly also near the boundaries of the m/z range
* Speedup of the generation of centroided spectra. Depending on the situation, spectrum extraction is now up to 20% faster


## In Development TDF-SDK 2.21.0
DLL v2.24.*
* Added support for requesting a specific re-calibration by id for tdf and tsf

## Release TDF-SDK 2.21.0 2022-05-12
DLL v2.21.104.32
* TDF
	* Added support for pressure compensation with tims_open_v2
	* Replace tims_extract_centroided_spectrum_for_frame with a _v2 that uses a peakfinder with improved resolution settings
	* Added tims_extract_centroided_spectrum_for_frame_ext that allows to customize the peakfinder resolution
	* Added tims_extract_chromatograms
* TSF
	* Depracted tsf_read_*_spectrum, replaced with tsf_read_*_spectrum_v2 returning int32_t instead of uint32_t, -1 for error
* Improved tims_index_to_mz performance
* Updated the python wrappers for the new API
* Modernized the C++ example project
* Supported tdf versions 3.x and 2.x
* Supported tsf versions 3.x

## Release TDF-SDK 2.8.7.1 2020-12-17
DLL v2.8.801.56
* Official release of tdf-sdk, functionality as in prerelease 2.8.7
* Supported tdf version 3.5 to 2.0

## Prerelease: tdf-sdk 2.8.7 2020-02-20
DLL v2.8.107.*
* Added two new functions to extract “pseudo”-spectra from frames
	* tims_extract_line_spectrum_for_frame: extract a centroided spectrum from a frame
	* tims_extract_profile_for_frame: extract a “pseudo” profile from a frame

## Prerelease: tdf-sdk 2.7.0 2020-01-09
DLL v2.7.103.49
* Added two new functions to convert from 1/K0 values to CCS values
	* tims_oneoverk0_to_ccs_for_mz: Converts the 1/K0 value to CCS (in Angstrom^2) using the Mason-Shamp equation
	* tims_ccs_to_oneoverk0_for_mz: Converts the CCS (in Angstrom^2) to 1/K0 using the Mason-Shamp equation

## Prerelease: tdf-sdk 2.4.4 2019-04-17
DLL v2.4.500.18
* Added two new functions and a callback definition to extract MsMs spectra from PASEF data
	* tims_read_pasef_msms: calculates all MsMs spectra for a given list of precursor IDs
	* tims_read_pasef_msms_for_frame: calculates all MsMs spectra for a given frame ID
	* msms_spectrum_functor: callback function that needs to be provided by the user
	
## Prerelease: tdf-sdk 2.4.3 2018-12-13
DLL v2.4.400.6
* Supported tdf version: 3.1, 3.0, 2.0
* Support for compressed tdf. See table GlobalMetadata, property TimsCompressionType=2
* Used for release of timsTOF and timsTOF pro acquisition software – otofControl 6.0
* Fixed symbol export of shared library libtimsdata.so. 

Prerelease: tdf-sdk 2.3.2 2018-05-03
DLL v2.3.300.188
* Supported tdf version: 3.0, 2.0
* Support for compressed tdf. See table GlobalMetadata, property TimsCompressionType=2
* Used for release of timsTOF and timsTOF pro acquisition software – otofControl 5.1
* Introduced tdf version 3.0. Database schema identical to tdf version 2.0 schema
* Changed normalization of intensities to a factor 100ms/accu-time
* Support for reading recalibration from calibration.sqlite files

## Prerelease: tdf-sdk 2.2.1 2017-08-28
DLL v2.2.202.82
* Supported tdf version: 2.0
* Used for release of timsTOF acquisition software – otofControl 5.0 SR1
* Used for release of timsTOF pro acquisition software – otofControl 5.0 SR2
* Introduced normalization of intensities by a factor ramp-time/accu-time
* API function tims_read_scans is replaced by tims_read_scans_v2. The function tims_read_scans does not required TimsId as input but takes the id of the frame instead.

## Prerelease: tdf-sdk 1.0.1 2016-11-14
DLL 1.0.201.222
* Supported tdf version: 1.0
* Used for beta versions of timsTOF acquisition software – otofContro
